package orders

import (
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestValidDistrictDispatch(t *testing.T) {
	const (
		warehouse = "6f0f6e8a-1d2b-4c3d-8e9f-0a1b2c3d4e5f"
		district  = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"
		male      = "0b1c2d3e-4f5a-4b6c-8d7e-8f9a0b1c2d3e"
		female    = "1c2d3e4f-5a6b-4c7d-8e8f-9a0b1c2d3e4f"
	)
	text := func(value string) *string { return &value }
	valid := func() DistrictDispatchInput {
		return DistrictDispatchInput{WarehouseID: warehouse, DistrictStoreID: district,
			Lines: []DistrictDispatchLine{{CondomID: male, Quantity: 200}, {CondomID: female, Quantity: 50}}}
	}

	in := valid()
	in.Note, in.WaybillNumber, in.DriverName = text("  Quarterly allocation "), text("   "), text(" John Okello ")
	if field, message := validDistrictDispatch(&in); message != "" {
		t.Fatalf("a valid dispatch was refused: %s %s", field, message)
	}
	if *in.Note != "Quarterly allocation" || in.WaybillNumber != nil || *in.DriverName != "John Okello" {
		t.Fatalf("not normalised: note %q, waybill %v, driver %q", *in.Note, in.WaybillNumber, *in.DriverName)
	}

	for _, tc := range []struct {
		name, field, message string
		change               func(*DistrictDispatchInput)
	}{
		{"no warehouse", "warehouse_store_id", "warehouse_store_id", func(in *DistrictDispatchInput) { in.WarehouseID = "NMS" }},
		{"no district", "district_store_id", "district_store_id", func(in *DistrictDispatchInput) { in.DistrictStoreID = "" }},
		{"to itself", "district_store_id", "district store", func(in *DistrictDispatchInput) { in.DistrictStoreID = warehouse }},
		{"no lines", "lines", "between 1 and 20", func(in *DistrictDispatchInput) { in.Lines = nil }},
		{"too many lines", "lines", "between 1 and 20", func(in *DistrictDispatchInput) {
			in.Lines = make([]DistrictDispatchLine, 21)
		}},
		{"bad product", "", "line 2: provide the condom_id", func(in *DistrictDispatchInput) { in.Lines[1].CondomID = "female" }},
		{"repeated product", "", "line 2: the product is already on line 1", func(in *DistrictDispatchInput) {
			in.Lines[1].CondomID = male
		}},
		{"nothing to send", "", "line 1: quantity", func(in *DistrictDispatchInput) { in.Lines[0].Quantity = 0 }},
		{"long note", "note", "note", func(in *DistrictDispatchInput) { in.Note = text(strings.Repeat("a", 4001)) }},
		{"long reason", "expiry_exception_reason", "1000", func(in *DistrictDispatchInput) {
			in.ExpiryExceptionReason = text(strings.Repeat("a", 1001))
		}},
		{"long phone", "driver_phone", "30", func(in *DistrictDispatchInput) { in.DriverPhone = text(strings.Repeat("7", 31)) }},
	} {
		in := valid()
		tc.change(&in)
		field, message := validDistrictDispatch(&in)
		if field != tc.field || !strings.Contains(message, tc.message) {
			t.Errorf("%s: got %q %q, want field %q and a message with %q", tc.name, field, message, tc.field, tc.message)
		}
	}
}

func TestLineError(t *testing.T) {
	err := lineError{line: 2, err: errNoFreeStock}
	if !strings.HasPrefix(err.Error(), "line 2: not enough free stock") {
		t.Errorf("message: %s", err)
	}
	if !errors.Is(err, errNoFreeStock) {
		t.Error("errors.Is does not see the cause through the line")
	}
}

func TestLineMessageKeepsTheLine(t *testing.T) {
	for name, tc := range map[string]struct {
		err  error
		want string
	}{
		"inactive product": {lineError{line: 3, err: errInactiveProduct}, "line 3: this product is inactive and cannot be sent"},
		"missing unit":     {lineError{line: 2, err: &pgconn.PgError{Code: "23503"}}, "line 2: a referenced store, product or unit does not exist"},
		"own message":      {lineError{line: 1, err: errNoFreeStock}, ""},
		"not a line":       {errInactiveProduct, ""},
	} {
		if got := lineMessage(tc.err); got != tc.want {
			t.Errorf("%s: %q, want %q", name, got, tc.want)
		}
	}
}
