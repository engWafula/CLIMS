package orders

import (
	"errors"
	"strconv"
	"strings"
	"unicode/utf8"

	"clims-backend/internal/features/audit"
	"clims-backend/internal/features/rbac"
	"clims-backend/internal/features/stock"
	"clims-backend/internal/features/users"
	"clims-backend/internal/pkg/request"
	"clims-backend/internal/pkg/response"

	"github.com/gofiber/fiber/v3"
)

// stockout reports that a hotspot has run out of a product. The district's DCFPs are notified; no
// order is created.
func (h *Handler) stockout(c fiber.Ctx) error {
	// A notification names a condom category (male, female or both) and no product or quantity:
	// the district decides what to send.
	var input struct {
		HotSpotID      string  `json:"hot_spot_id"`
		CondomCategory string  `json:"condom_category"`
		Message        *string `json:"message"`
	}
	if err := request.DecodeJSON(c, &input); err != nil {
		return response.Error(c, 400, "invalid request body", nil)
	}
	hotSpotID, hotSpotErr := request.ParseUUID(input.HotSpotID)
	if hotSpotErr != nil {
		return response.Error(c, 422, "provide the hotspot's UUID", nil)
	}
	if !ValidSelection(input.CondomCategory) {
		return response.Error(c, 422, "condom_category must be male, female or both",
			map[string]string{"condom_category": "Choose male, female or both."})
	}
	var ok bool
	if input.Message, ok = trimComment(input.Message); !ok {
		return response.Error(c, 422, "message must be at most 4000 characters", nil)
	}
	access := scopeFor(users.CurrentUser(c))
	// A hotspot manager reports for their own hotspot only, whatever else their account holds,
	// matching what they may see (visibleReports).
	allowed := assigned(access.hotSpotID, hotSpotID) || (access.hotSpotID == nil && access.allStores)
	if !allowed && access.hotSpotID == nil && access.stockoutDistrict {
		// A VHT may raise an alert on behalf of any active hotspot in the district they work in.
		var err error
		if allowed, err = h.repo.activeInDistrictOf(c.Context(), access.userID, hotSpotID); err != nil {
			return workflowError(c, err)
		}
	}
	if !allowed {
		return workflowError(c, errWorkflowForbidden)
	}
	report, repeated, err := h.repo.reportStockout(c.Context(), access.userID, hotSpotID, input.CondomCategory, input.Message)
	if err != nil {
		return workflowError(c, err)
	}
	if repeated {
		return response.Success(c, 200, "added to the hotspot's open stockout notification", report)
	}
	return response.Success(c, 201, "stockout reported to the district", report)
}

func (h *Handler) stockoutDetail(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	user := users.CurrentUser(c)
	access := scopeFor(user)
	if !user.HasPermission("orders:read") {
		// A reporter without orders:read sees only reports they sent or about their own hotspot,
		// whatever else their role holds.
		access = scope{userID: user.ID, hotSpotID: user.HotSpotID}
	}
	detail, err := h.repo.getStockout(c.Context(), access, id)
	if err != nil {
		return workflowError(c, err)
	}
	return response.Success(c, 200, "", detail)
}

// delivery records the district's delivery to a hotspot against its notification.
func (h *Handler) delivery(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	var input DeliveryInput
	if err = request.DecodeJSON(c, &input); err != nil {
		return response.Error(c, 400, "invalid request body", nil)
	}
	if message := validDelivery(&input); message != "" {
		return response.Error(c, 422, message, nil)
	}
	detail, created, err := h.repo.recordDelivery(c.Context(), scopeFor(users.CurrentUser(c)), id, input)
	if err != nil {
		return workflowError(c, err)
	}
	if !created {
		return response.Success(c, 200, "this delivery was already recorded", detail)
	}
	return response.Success(c, 201, "delivery recorded; the hotspot manager acknowledges what arrives", detail)
}

func validDelivery(in *DeliveryInput) string {
	if len(in.Lines) == 0 || len(in.Lines) > 20 {
		return "a delivery needs between 1 and 20 lines"
	}
	for i := range in.Lines {
		line := &in.Lines[i]
		id, err := request.ParseUUID(line.CondomID)
		if err != nil {
			return "each line needs a condom_id UUID"
		}
		line.CondomID = id
		if line.Quantity < 1 || line.Quantity > 1_000_000 {
			return "each line needs a quantity between 1 and 1000000"
		}
		if line.UnitOfMeasureID != nil {
			unit, err := request.ParseUUID(*line.UnitOfMeasureID)
			if err != nil {
				return "unit_of_measure_id must be a UUID"
			}
			line.UnitOfMeasureID = &unit
		}
	}
	if in.RiderID != nil {
		rider, err := request.ParseUUID(*in.RiderID)
		if err != nil {
			return "rider_id must be a UUID"
		}
		in.RiderID = &rider
	}
	var ok bool
	if in.Note, ok = trimComment(in.Note); !ok {
		return "note must be at most 4000 characters"
	}
	if !validExceptionReason(&in.ExpiryExceptionReason) {
		return "expiry_exception_reason must be at most 1000 characters"
	}
	if in.ClientReference != nil {
		reference := strings.TrimSpace(*in.ClientReference)
		if reference == "" || len(reference) > 100 {
			return "client_reference must be 1 to 100 characters"
		}
		in.ClientReference = &reference
	}
	return ""
}

// rejection closes a request the district will not supply, with a reason the hotspot reads.
func (h *Handler) rejection(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	var input RejectionInput
	if err = request.DecodeJSON(c, &input); err != nil {
		return response.Error(c, 400, "invalid request body", nil)
	}
	reason := ""
	if input.Reason != nil {
		reason = strings.TrimSpace(*input.Reason)
	}
	if reason == "" {
		return workflowError(c, errStockoutReason)
	}
	if utf8.RuneCountInString(reason) > 1000 {
		const message = "reason must be at most 1000 characters"
		return response.Error(c, 422, message, map[string]string{"reason": message})
	}
	detail, changed, err := h.repo.rejectStockout(c.Context(), scopeFor(users.CurrentUser(c)), id, reason)
	if err != nil {
		return workflowError(c, err)
	}
	if !changed {
		return response.Success(c, 200, "this request was already rejected", detail)
	}
	return response.Success(c, 200, "request rejected; the hotspot is told why", detail)
}

// acknowledgement records the hotspot manager's count of what arrived.
func (h *Handler) acknowledgement(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	var input AcknowledgementInput
	if err = request.DecodeJSON(c, &input); err != nil {
		return response.Error(c, 400, "invalid request body", nil)
	}
	if len(input.Lines) == 0 || len(input.Lines) > 100 {
		return response.Error(c, 422, "acknowledge between 1 and 100 lines", nil)
	}
	for i := range input.Lines {
		line, err := request.ParseUUID(input.Lines[i].LineID)
		if err != nil || input.Lines[i].Pieces < 0 || input.Lines[i].Pieces > 10_000_000 {
			return response.Error(c, 422, "each line needs a line_id UUID and pieces between 0 and 10000000", nil)
		}
		input.Lines[i].LineID = line
	}
	detail, err := h.repo.acknowledge(c.Context(), scopeFor(users.CurrentUser(c)), id, input)
	if err != nil {
		return workflowError(c, err)
	}
	return response.Success(c, 200, "acknowledgement recorded", detail)
}

func (h *Handler) stockouts(c fiber.Ctx) error {
	limit, offset, ok := page(c)
	if !ok {
		return response.Error(c, 400, pageError, nil)
	}
	var hotSpotID *string
	if raw := c.Query("hot_spot_id"); raw != "" {
		id, err := request.ParseUUID(raw)
		if err != nil {
			return response.Error(c, 400, "hot_spot_id must be a UUID", nil)
		}
		hotSpotID = &id
	}
	reports, err := h.repo.listStockouts(c.Context(), scopeFor(users.CurrentUser(c)), hotSpotID, limit, offset)
	if err != nil {
		return workflowError(c, err)
	}
	return response.Success(c, 200, "", reports)
}

// warehouseRequest places a DCFP's order with NMS or JMS for a condom category and quantity, with no
// product or unit: the warehouse chooses the product at review and the order takes its unit.
func (h *Handler) warehouseRequest(c fiber.Ctx) error {
	var input WarehouseRequestInput
	if err := request.DecodeJSON(c, &input); err != nil {
		return response.Error(c, 400, "invalid request body", nil)
	}
	warehouseID, err := request.ParseUUID(input.WarehouseID)
	if err != nil {
		const message = "provide the warehouse_store_id UUID"
		return response.Error(c, 422, message, map[string]string{"warehouse_store_id": message})
	}
	input.WarehouseID = warehouseID
	if input.CondomCategory != SelectionMale && input.CondomCategory != SelectionFemale {
		const message = "condom_category must be male or female"
		return response.Error(c, 422, message, map[string]string{"condom_category": message})
	}
	if input.Quantity < 1 {
		const message = "quantity must be a positive whole number"
		return response.Error(c, 422, message, map[string]string{"quantity": message})
	}
	var ok bool
	if input.Comment, ok = trimComment(input.Comment); !ok {
		return response.Error(c, 422, "comment must be at most 4000 characters", nil)
	}
	order, err := h.repo.createWarehouseRequest(c.Context(), scopeFor(users.CurrentUser(c)), input)
	if err != nil {
		return workflowError(c, err)
	}
	return response.Success(c, 201, "order sent to the warehouse", order)
}

var actionPermissions = map[string]string{
	"review": "orders:process", "check-stock": "orders:process", "dispatch": "orders:process",
	"reject": "orders:process", "receive": "orders:receive",
}

func (h *Handler) action(c fiber.Ctx) error {
	action := c.Params("action")
	permission, exists := actionPermissions[action]
	if !exists {
		return response.Error(c, 404, "unknown order action", nil)
	}
	return rbac.RequirePermission(permission)(c)
}

func (h *Handler) performAction(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	var input ActionInput
	if len(c.Body()) != 0 {
		if err = request.DecodeJSON(c, &input); err != nil {
			return response.Error(c, 400, "invalid request body", nil)
		}
	}
	action := c.Params("action")
	if action == "reject" && !validReason(&input.Reason) {
		return workflowError(c, errRejectReason)
	}
	if !validActionInput(action, &input) {
		return workflowError(c, errWorkflowInput)
	}
	order, err := h.repo.act(c.Context(), scopeFor(users.CurrentUser(c)), id, action, input)
	if err != nil {
		return workflowError(c, err)
	}
	return response.Success(c, 200, "", order)
}

// validActionInput accepts only the fields an action uses: the product and an approved quantity at
// review, a reason to reject, an optional positive quantity_issued, expiry exception and transport at
// dispatch, and a nonnegative quantity_received with an optional discrepancy_note at receipt.
func validActionInput(action string, input *ActionInput) bool {
	if !validExceptionReason(&input.ExpiryExceptionReason) {
		return false
	}
	if input.Reason != nil && action != "reject" {
		return false
	}
	for _, field := range []struct {
		value **string
		limit int
	}{{&input.WaybillNumber, 100}, {&input.VehicleRegistration, 30}, {&input.DriverName, 200}, {&input.DriverPhone, 30}} {
		if *field.value == nil {
			continue
		}
		if action != "dispatch" {
			return false
		}
		// Transport is optional: blank counts as not given.
		trimmed := strings.TrimSpace(**field.value)
		if utf8.RuneCountInString(trimmed) > field.limit {
			return false
		}
		*field.value = &trimmed
		if trimmed == "" {
			*field.value = nil
		}
	}
	if input.DiscrepancyNote != nil {
		*input.DiscrepancyNote = strings.TrimSpace(*input.DiscrepancyNote)
		if *input.DiscrepancyNote == "" || len(*input.DiscrepancyNote) > 4000 {
			return false
		}
	}
	if input.CondomID != nil {
		id, err := request.ParseUUID(*input.CondomID)
		if err != nil || action != "review" {
			return false
		}
		input.CondomID = &id
	}
	if (input.QuantityReceived != nil) != (action == "receive") ||
		(input.QuantityIssued != nil && (action != "dispatch" || *input.QuantityIssued < 1)) ||
		(input.QuantityApproved != nil && (action != "review" || *input.QuantityApproved < 1)) ||
		(input.ExpiryExceptionReason != nil && action != "dispatch") ||
		(input.DiscrepancyNote != nil && action != "receive") {
		return false
	}
	return input.QuantityReceived == nil || *input.QuantityReceived >= 0
}

func (h *Handler) events(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	return h.eventList(c, id)
}

func (h *Handler) eventList(c fiber.Ctx, id string) error {
	offset, err := strconv.ParseInt(c.Query("offset", "0"), 10, 32)
	if err != nil || offset < 0 {
		return response.Error(c, 400, "offset must be nonnegative", nil)
	}
	events, err := h.repo.listEvents(c.Context(), scopeFor(users.CurrentUser(c)), id, int32(offset))
	if err != nil {
		return workflowError(c, err)
	}
	return response.Success(c, 200, "", events)
}

func workflowError(c fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, errReportNotFound):
		return response.Error(c, 404, err.Error(), nil)
	case errors.Is(err, errWorkflowForbidden), errors.Is(err, errNotDistrictStore), errors.Is(err, errNotManager):
		return response.Error(c, 403, err.Error(), nil)
	case errors.Is(err, errWorkflowConflict), errors.Is(err, errNotEnoughStock), errors.Is(err, errAlreadyFulfilled),
		errors.Is(err, errAckChanged), errors.Is(err, errExpiredStock), errors.Is(err, errRequestRejected),
		errors.Is(err, errRejectAfterSend):
		return response.Error(c, 409, err.Error(), nil)
	case errors.Is(err, errWorkflowInput), errors.Is(err, errHotSpotRoute), errors.Is(err, errUnknownProduct),
		errors.Is(err, errNotSelected), errors.Is(err, errDeliveryUnit):
		return response.Error(c, 422, err.Error(), nil)
	case errors.Is(err, stock.ErrNearExpiry):
		return response.Error(c, 422, err.Error(), map[string]string{"expiry_exception_reason": err.Error()})
	case errors.Is(err, errRiderNotEligible):
		return response.Error(c, 422, err.Error(), map[string]string{"rider_id": err.Error()})
	case errors.Is(err, errRejectReason), errors.Is(err, errStockoutReason):
		return response.Error(c, 422, err.Error(), map[string]string{"reason": err.Error()})
	case errors.Is(err, errNotWarehouse):
		return response.Error(c, 422, err.Error(), map[string]string{"warehouse_store_id": err.Error()})
	case errors.Is(err, errInactiveProduct):
		const message = "This product is inactive and cannot be ordered."
		return response.Error(c, 422, message, map[string]string{"condom_id": message})
	case errors.Is(err, errChooseProduct), errors.Is(err, errWrongCategory), errors.Is(err, errProductUnit):
		return response.Error(c, 422, err.Error(), map[string]string{"condom_id": err.Error()})
	default:
		return orderError(c, err)
	}
}

// validExceptionReason trims an expiry exception reason, dropping it when blank; false when too long.
func validExceptionReason(reason **string) bool {
	if *reason == nil {
		return true
	}
	trimmed := strings.TrimSpace(**reason)
	if trimmed == "" {
		*reason = nil
		return true
	}
	*reason = &trimmed
	return len(trimmed) <= 1000
}

// trimComment trims a free-text message, dropping it when blank. The result is false when it is
// longer than the 4000 characters the API accepts.
// validReason trims a rejection reason, which is required and at most 4000 characters.
func validReason(reason **string) bool {
	if *reason == nil {
		return false
	}
	trimmed := strings.TrimSpace(**reason)
	*reason = &trimmed
	return trimmed != "" && utf8.RuneCountInString(trimmed) <= 4000
}

func trimComment(comment *string) (*string, bool) {
	if comment == nil {
		return nil, true
	}
	trimmed := strings.TrimSpace(*comment)
	if trimmed == "" {
		return nil, true
	}
	return &trimmed, len(trimmed) <= 4000
}

// riders lists the delivery agents who may carry a delivery for a stockout report: active users
// with orders:deliver working in the district of the store the report went to.
func (h *Handler) riders(c fiber.Ctx) error {
	id, err := request.UUIDParam(c)
	if err != nil {
		return response.Error(c, 400, err.Error(), nil)
	}
	riders, err := h.repo.listRiders(c.Context(), scopeFor(users.CurrentUser(c)), id)
	if err != nil {
		return workflowError(c, err)
	}
	return response.Success(c, 200, "", riders)
}

// myDeliveries lists the hotspot deliveries named for the signed-in delivery agent, newest first.
func (h *Handler) myDeliveries(c fiber.Ctx) error {
	limit, offset, ok := page(c)
	if !ok {
		return response.Error(c, 400, pageError, nil)
	}
	deliveries, err := h.repo.riderDeliveries(c.Context(), users.CurrentUser(c).ID, limit, offset)
	if err != nil {
		return workflowError(c, err)
	}
	return response.Success(c, 200, "", deliveries)
}

// requireReportReader lets a stockout report's details through to holders of orders:read, and to
// those who report stockouts (orders:stockout), so a VHT can follow the requests they sent;
// stockoutDetail limits the latter to their own reports.
func requireReportReader(c fiber.Ctx) error {
	user := users.CurrentUser(c)
	if user.HasPermission("orders:read") || user.HasPermission("orders:stockout") {
		return c.Next()
	}
	c.Locals(audit.DeniedPermissionKey, "orders:read")
	return response.Error(c, 403, "permission denied", nil)
}

// requireAcknowledger lets through the hotspot's manager (orders:stockout) and delivery agents
// (orders:deliver); acknowledge then limits an agent to the deliveries named for them.
func requireAcknowledger(c fiber.Ctx) error {
	user := users.CurrentUser(c)
	if user.HasPermission("orders:stockout") || user.HasPermission("orders:deliver") {
		return c.Next()
	}
	c.Locals(audit.DeniedPermissionKey, "orders:stockout")
	return response.Error(c, 403, "permission denied", nil)
}
