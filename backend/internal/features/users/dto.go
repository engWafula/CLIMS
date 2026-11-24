package users

import (
	"encoding/json"
	"strings"
)

type AccountInput struct {
	Username   string             `json:"username" validate:"required,min=3,max=50"`
	Email      string             `json:"email" validate:"required,email,max=255"`
	Password   string             `json:"password" validate:"required,min=8,max=72"`
	FirstName  string             `json:"first_name" validate:"max=20"`
	LastName   string             `json:"last_name" validate:"max=20"`
	Firstname  string             `json:"firstname" validate:"max=20"`
	Lastname   string             `json:"lastname" validate:"max=20"`
	Phone      string             `json:"phone_number" validate:"max=15"`
	Location   *string            `json:"location" validate:"omitempty,max=15"`
	Assignment FacilityAssignment `json:"-"`
	// StoreID is the store whose orders and stock the account works with; see CreateUserRequest.
	StoreID *string `json:"-"`
	// SubcountyID is where a field worker works; set by POST /users/district (DistrictUserRequest).
	SubcountyID *string `json:"-"`
}

type FacilityAssignment struct {
	OrganisationUnitID *string `json:"organisation_unit_id" validate:"omitempty,uuid_rfc4122"`
	HotSpotID          *string `json:"hot_spot_id" validate:"omitempty,uuid_rfc4122"`
}

type CreateUserRequest struct {
	AccountInput
	FacilityAssignment
	// Optional: a DCFP's or delivery agent's district store, or a warehouse's national store.
	StoreID *string   `json:"store_id" validate:"omitempty,uuid_rfc4122"`
	RoleID  string    `json:"role_id" validate:"omitempty,uuid_rfc4122"`
	RoleIDs *[]string `json:"role_ids" validate:"omitempty,min=1,max=100,dive,uuid_rfc4122"`
}

func (input *AccountInput) Normalize() {
	input.Username = strings.TrimSpace(input.Username)
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	if input.FirstName == "" {
		input.FirstName = input.Firstname
	}
	if input.LastName == "" {
		input.LastName = input.Lastname
	}
}

type AssignRoleRequest struct {
	RoleID string `json:"role_id" validate:"required,uuid_rfc4122"`
}

type UpdateStatusRequest struct {
	Status string `json:"status" validate:"required,oneof=active disabled"`
}

type SetRolesRequest struct {
	RoleIDs *[]string `json:"role_ids" validate:"required,max=100,dive,uuid_rfc4122"`
}

// OptionalID is a JSON field holding a UUID string or null. Set tells a field sent as
// null apart from one left out.
type OptionalID struct {
	Set   bool
	Value *string
}

func (o *OptionalID) UnmarshalJSON(data []byte) error {
	o.Set = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	o.Value = &value
	return nil
}

// SetStoreRequest assigns a user's store; null clears it.
type SetStoreRequest struct {
	StoreID OptionalID `json:"store_id"`
}
