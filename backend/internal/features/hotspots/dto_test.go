package hotspots

import (
	"testing"

	"clims-backend/internal/pkg/validator"
)

func validSubmission() SubmitRequest {
	latitude, longitude, dispenser := 0.3476, 32.5825, true
	return SubmitRequest{Details: Details{
		Name: "  Mama's   Bar ", Type: "Bar",
		RegionID:    "11111111-1111-4111-8111-111111111111",
		DistrictID:  "22222222-2222-4222-8222-222222222222",
		SubcountyID: "33333333-3333-4333-8333-333333333333",
		Latitude:    &latitude, Longitude: &longitude,
		ContactPersonName: "Jane", ContactPersonPhone: "+256 700-123 456",
		HasCondomDispenser: &dispenser,
	}}
}

func TestSubmissionNormalizesAndValidates(t *testing.T) {
	blank := "   "
	request := validSubmission()
	request.Comment, request.DispenserCondition, request.Village = &blank, &blank, &blank
	request.Normalize()
	if err := validator.Validate.Struct(request); err != nil {
		t.Fatalf("valid submission rejected: %v", err)
	}
	if request.Name != "Mama's   Bar" {
		t.Fatalf("name not trimmed: %q", request.Name)
	}
	if request.ContactPersonPhone != "+256700123456" {
		t.Fatalf("phone separators kept: %q", request.ContactPersonPhone)
	}
	if request.Comment != nil || request.DispenserCondition != nil || request.Village != nil {
		t.Fatal("blank optional text should become nil")
	}
}

func TestSubmissionRejectsMissingOrInvalidFields(t *testing.T) {
	outOfRange := 91.0
	longVillage := string(make([]byte, 101))
	cases := map[string]func(*SubmitRequest){
		"name":                 func(r *SubmitRequest) { r.Name = " " },
		"type":                 func(r *SubmitRequest) { r.Type = "" },
		"region_id":            func(r *SubmitRequest) { r.RegionID = "not-a-uuid" },
		"subcounty_id":         func(r *SubmitRequest) { r.SubcountyID = "" },
		"village":              func(r *SubmitRequest) { r.Village = &longVillage },
		"latitude":             func(r *SubmitRequest) { r.Latitude = &outOfRange },
		"longitude":            func(r *SubmitRequest) { r.Longitude = nil },
		"contact_person_name":  func(r *SubmitRequest) { r.ContactPersonName = "" },
		"contact_person_phone": func(r *SubmitRequest) { r.ContactPersonPhone = "07-12" },
		"has_condom_dispenser": func(r *SubmitRequest) { r.HasCondomDispenser = nil },
	}
	for field, mutate := range cases {
		request := validSubmission()
		mutate(&request)
		request.Normalize()
		err := validator.Validate.Struct(request)
		if _, reported := validator.FormatErrors(err)[field]; err == nil || !reported {
			t.Errorf("%s: expected a validation error, got %v", field, err)
		}
	}
}

func TestZeroCoordinatesAreAllowed(t *testing.T) {
	zero := 0.0
	request := validSubmission()
	request.Latitude, request.Longitude = &zero, &zero
	request.Normalize()
	if err := validator.Validate.Struct(request); err != nil {
		t.Fatalf("coordinates of 0 should be valid: %v", err)
	}
}

func TestOnlyActiveReviewIsActiveStatus(t *testing.T) {
	for review, want := range map[string]string{
		ReviewSubmitted: StatusInactive, ReviewRejected: StatusInactive,
		ReviewDeactivated: StatusInactive, ReviewActive: StatusActive,
	} {
		if got := statusFor(review); got != want {
			t.Errorf("%s: status %s, want %s", review, got, want)
		}
	}
}

func TestPositionErrorsRefuseNullIsland(t *testing.T) {
	at := func(lat, lng float64) Details { return Details{Latitude: &lat, Longitude: &lng} }
	for name, tc := range map[string]struct {
		d       Details
		refused bool
	}{
		"(0, 0)":            {at(0, 0), true},
		"Kampala":           {at(0.3476, 32.5825), false},
		"on the equator":    {at(0, 32.5), false},
		"missing, required": {Details{}, false},
	} {
		if got := tc.d.positionErrors() != nil; got != tc.refused {
			t.Errorf("%s: refused=%v, want %v", name, got, tc.refused)
		}
	}
}
