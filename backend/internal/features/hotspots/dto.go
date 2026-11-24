package hotspots

import "strings"

// Details is everything a VHT records about a hotspot, on submission and on edit.
// The contact person is the hotspot manager.
type Details struct {
	Name               string   `json:"name" validate:"required,max=100"`
	Type               string   `json:"type" validate:"required,max=100"`
	RegionID           string   `json:"region_id" validate:"required,uuid_rfc4122"`
	DistrictID         string   `json:"district_id" validate:"required,uuid_rfc4122"`
	SubcountyID        string   `json:"subcounty_id" validate:"required,uuid_rfc4122"`
	Village            *string  `json:"village" validate:"omitempty,max=100"`
	Latitude           *float64 `json:"latitude" validate:"required,gte=-90,lte=90"`
	Longitude          *float64 `json:"longitude" validate:"required,gte=-180,lte=180"`
	ContactPersonName  string   `json:"contact_person_name" validate:"required,max=100"`
	ContactPersonPhone string   `json:"contact_person_phone" validate:"required,phone"`
	HasCondomDispenser *bool    `json:"has_condom_dispenser" validate:"required"`
	DispenserCondition *string  `json:"dispenser_condition" validate:"omitempty,max=255"`
}

type SubmitRequest struct {
	Details
	// Optional; stored as the hotspot's first comment.
	Comment *string `json:"comment" validate:"omitempty,max=2000"`
}

// CommentRequest is a plain comment or the reason for a DCFP decision.
type CommentRequest struct {
	Comment string `json:"comment" validate:"required,max=2000"`
}

var phoneSeparators = strings.NewReplacer(" ", "", "-", "", "(", "", ")", "")

func (d *Details) Normalize() {
	d.Name = strings.TrimSpace(d.Name)
	d.Type = strings.TrimSpace(d.Type)
	d.Village = trimmedOrNil(d.Village)
	d.ContactPersonName = strings.TrimSpace(d.ContactPersonName)
	d.ContactPersonPhone = phoneSeparators.Replace(strings.TrimSpace(d.ContactPersonPhone))
	d.RegionID = strings.ToLower(strings.TrimSpace(d.RegionID))
	d.DistrictID = strings.ToLower(strings.TrimSpace(d.DistrictID))
	d.SubcountyID = strings.ToLower(strings.TrimSpace(d.SubcountyID))
	d.DispenserCondition = trimmedOrNil(d.DispenserCondition)
}

// positionErrors refuses (0, 0): it is the position a phone or form reports when it has none, it lies in
// the Gulf of Guinea, and the hotspot would never appear on the map. Nil when the position is usable.
func (d *Details) positionErrors() map[string]string {
	if d.Latitude == nil || d.Longitude == nil || *d.Latitude != 0 || *d.Longitude != 0 {
		return nil
	}
	const message = "Record where the hotspot is; (0, 0) is not a position in Uganda."
	return map[string]string{"latitude": message, "longitude": message}
}

func (r *SubmitRequest) Normalize() {
	r.Details.Normalize()
	r.Comment = trimmedOrNil(r.Comment)
}

func (r *CommentRequest) Normalize() {
	r.Comment = strings.TrimSpace(r.Comment)
}

func trimmedOrNil(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
