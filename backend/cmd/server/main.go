package main

import (
	"context"
	"log"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"clims-backend/internal/config"
	"clims-backend/internal/database"
	"clims-backend/internal/features/apidocs"
	"clims-backend/internal/features/audit"
	"clims-backend/internal/features/auth"
	"clims-backend/internal/features/catalogue"
	"clims-backend/internal/features/health"
	"clims-backend/internal/features/hotspots"
	"clims-backend/internal/features/inventory"
	"clims-backend/internal/features/locations"
	"clims-backend/internal/features/notifications"
	"clims-backend/internal/features/orders"
	"clims-backend/internal/features/rbac"
	"clims-backend/internal/features/reports"
	"clims-backend/internal/features/users"
	"clims-backend/internal/middleware"

	"github.com/gofiber/fiber/v3"
	"github.com/gofiber/fiber/v3/middleware/cors"
	"github.com/gofiber/fiber/v3/middleware/helmet"
	"github.com/gofiber/fiber/v3/middleware/recover"
	"github.com/gofiber/fiber/v3/middleware/requestid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Version variables injected at build time via -ldflags
var (
	Version    = "2.4.0"
	CommitHash = "none"
	BuildTime  = "unknown"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}
	// Refuse to start with the test probe in production, before touching the database.
	probe, err := config.IdentitySyncProbe(cfg.AppEnv, cfg.IdentitySyncTestProbe)
	if err != nil {
		log.Fatalf("CLIMS identity sync configuration: %v", err)
	}
	if probe && cfg.IdentitySyncClientID == "" {
		log.Fatalf("CLIMS identity sync configuration: IDENTITY_SYNC_TEST_PROBE=1 requires IDENTITY_SYNC_CLIENT_ID")
	}

	if err := database.RunMigrations(cfg.DSN()); err != nil {
		log.Fatalf("Migration error: %v", err)
	}

	ctx := context.Background()
	dbPool, err := pgxpool.New(ctx, cfg.DSN())
	if err != nil {
		log.Fatalf("Failed to create connection pool: %v", err)
	}
	defer dbPool.Close()

	// c.IP() is the client's real address behind nginx; see middleware.WithClientIP.
	app := fiber.New(middleware.WithClientIP(fiber.Config{}, cfg.TrustedProxies))
	app.Use(middleware.ClientIP())
	app.Use(recover.New())
	// Sets X-Request-ID so a logged failure can be matched to the request that caused it.
	app.Use(requestid.New())
	// Gives audit entries the request's address, device, request ID, user and session.
	auditor := audit.NewService(dbPool)
	app.Use(audit.Middleware(auditor))
	app.Use(middleware.NewSlogLogger())

	app.Use(helmet.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     []string{"http://localhost:3000"},
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Accept", "Authorization"},
		AllowCredentials: true,
	}))

	docsDir := os.Getenv("DOCS_DIR")
	if docsDir == "" {
		docsDir = "../docs"
	}
	apidocs.RegisterRoutes(app, os.DirFS(filepath.Join(docsDir, "api")))

	// Register Health Probes with Version info
	healthHandler := health.NewHandler(dbPool, Version, CommitHash, BuildTime)
	health.RegisterRoutes(app, healthHandler)

	v1 := app.Group("/api/v1")
	jwtAuthMiddleware := middleware.NewJWTMiddleware(cfg.JWTSecret)

	userRepo := users.NewRepository(dbPool, auditor)
	if cfg.IdentitySyncClientID != "" {
		discoveryCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		if probe {
			log.Printf("WARNING: identity-sync test session probe is on (APP_ENV=%s, IDENTITY_SYNC_TEST_PROBE=1); never use this outside a test environment", cfg.AppEnv)
		}
		err := auth.RegisterIdentitySync(discoveryCtx, app, userRepo, auth.IdentitySyncConfig{
			Issuer: cfg.OIDCIssuer, Audience: cfg.OIDCClientID, ServiceClient: cfg.IdentitySyncClientID,
			TestProbe: probe, JWTSecret: cfg.JWTSecret,
		})
		cancel()
		if err != nil {
			log.Fatalf("CLIMS identity sync configuration: %v", err)
		}
	}
	if cfg.OIDCClientID != "" {
		discoveryCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		sso, err := auth.NewSSO(discoveryCtx, cfg.OIDCIssuer, cfg.OIDCClientID, cfg.OIDCClientSecret, cfg.OIDCPublicOrigin, cfg.JWTSecret, userRepo)
		cancel()
		if err != nil {
			log.Fatalf("CLIMS portal sign-in configuration: %v", err)
		}
		sso.Register(app)
	}
	userService := users.NewService(userRepo)
	roleRepo := rbac.NewRepository(dbPool, auditor)
	activeUser := users.ActiveUser(userRepo)

	// One notification service for every feature; each registers its own types.
	notifier := notifications.NewService()
	notifier.MustRegister(hotspots.NotificationTypes()...)
	notifier.MustRegister(orders.NotificationTypes()...)
	notifier.MustRegister(inventory.NotificationTypes()...)
	// Push to the field app needs Firebase credentials. Without them, or with unusable ones, the API
	// still starts and notifications reach the inbox as before.
	if fcm, err := notifications.ConfiguredFCM(cfg.FirebaseCredentialsJSON, cfg.FirebaseCredentialsFile); err != nil {
		slog.Error("push notifications disabled: Firebase credentials are unusable", "error", err)
	} else if fcm == nil {
		slog.Info("push notifications disabled: FIREBASE_CREDENTIALS_JSON is not set")
	} else {
		notifier.EnablePush()
		go notifications.NewPushWorker(dbPool, fcm).Run(ctx, 5*time.Second)
		slog.Info("push notifications enabled")
	}

	auth.RegisterRoutes(v1, auth.NewHandler(userRepo, userService, cfg.JWTSecret, auditor), jwtAuthMiddleware, activeUser)
	users.RegisterRoutes(v1, users.NewHandler(userRepo, userService), jwtAuthMiddleware, activeUser)
	rbac.RegisterRoutes(v1, rbac.NewHandler(roleRepo), jwtAuthMiddleware, activeUser)
	orders.RegisterRoutes(v1, orders.NewRepository(dbPool, notifier, auditor), jwtAuthMiddleware, activeUser)
	hotspots.RegisterRoutes(v1, hotspots.NewRepository(dbPool, notifier, auditor), jwtAuthMiddleware, activeUser)
	inventory.RegisterRoutes(v1, inventory.NewRepository(dbPool, auditor), jwtAuthMiddleware, activeUser)
	reports.RegisterRoutes(v1, reports.NewRepository(dbPool), jwtAuthMiddleware, activeUser)
	locations.RegisterRoutes(v1, locations.NewHandler(dbPool), jwtAuthMiddleware, activeUser)
	notifications.RegisterRoutes(v1, notifications.NewRepository(dbPool), jwtAuthMiddleware, activeUser)
	audit.RegisterRoutes(v1, audit.NewRepository(dbPool), auditor, jwtAuthMiddleware, activeUser, rbac.RequirePermission("audit:read"))
	catalogue.RegisterRoutes(v1, catalogue.NewRepository(dbPool, auditor), jwtAuthMiddleware, activeUser)

	// Tells each store when a batch it holds is about to expire, and when it has. Every replica may run
	// it: each batch is announced once per state.
	go inventory.NewExpiryAlerts(dbPool, notifier).Watch(ctx, time.Hour)

	log.Printf("Server starting on port %s (Version: %s, Commit: %s)...", cfg.Port, Version, CommitHash)
	if err := app.Listen(":" + cfg.Port); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
