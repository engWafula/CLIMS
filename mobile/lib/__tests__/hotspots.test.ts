import { AxiosError } from "axios";
import {
  normalizePhone,
  OTHER_TYPE,
  phoneOk,
  PHONE_DIGITS,
  toLocalPhone,
  submitErrorMessage,
  toLocalHotspot,
  toSubmission,
  validateMapForm,
  type ApiHotspot,
  type MapForm,
} from "../hotspots";

jest.mock("@react-native-async-storage/async-storage", () => ({}));

const filled: MapForm = {
  regionId: "11111111-1111-4111-8111-111111111111",
  districtId: "22222222-2222-4222-8222-222222222222",
  subcountyId: "33333333-3333-4333-8333-333333333333",
  village: " Kigungu ",
  lat: 0.0512,
  lng: 32.4421,
  name: "  Kigungu   Lodge ",
  type: "Lodge",
  otherType: "",
  dispenser: "yes",
  condition: "Good",
  comment: "",
  contactName: " Sarah Nakirya ",
  contactPhone: "0772 123-456",
};

describe("validateMapForm", () => {
  it("accepts a complete form", () => {
    expect(validateMapForm(filled)).toEqual({});
  });

  it("requires what the API requires", () => {
    const e = validateMapForm({
      ...filled,
      regionId: "",
      districtId: "",
      subcountyId: "",
      lat: null,
      lng: null,
      name: " ",
      type: "",
      dispenser: "",
      contactName: "",
      contactPhone: "",
    });
    expect(Object.keys(e).sort()).toEqual(
      [
        "gps",
        "regionId",
        "districtId",
        "subcountyId",
        "name",
        "type",
        "dispenser",
        "contactName",
        "contactPhone",
      ].sort(),
    );
  });

  it("keeps village and comment optional", () => {
    expect(validateMapForm({ ...filled, village: "", comment: "" })).toEqual({});
  });

  it("needs a condition when there is a dispenser, and a description for Other", () => {
    expect(validateMapForm({ ...filled, condition: "" }).condition).toBeTruthy();
    expect(validateMapForm({ ...filled, dispenser: "no", condition: "" })).toEqual({});
    expect(validateMapForm({ ...filled, type: OTHER_TYPE }).otherType).toBeTruthy();
  });

  it("enforces the API's length limits", () => {
    expect(validateMapForm({ ...filled, name: "x".repeat(101) }).name).toMatch(/100/);
    expect(validateMapForm({ ...filled, comment: "x".repeat(2001) }).comment).toMatch(/2000/);
  });
});

describe("phone numbers", () => {
  it("normalises the way the API does", () => {
    expect(normalizePhone(" 0772 123-456 ")).toBe("0772123456");
  });

  it("accepts exactly a 10-digit Ugandan mobile written locally", () => {
    expect(phoneOk("0708832767")).toBe(true);
    expect(phoneOk("0772 123 456")).toBe(true);
    expect(phoneOk("070883276")).toBe(false); // 9 digits
    expect(phoneOk("07088327671")).toBe(false); // 11 digits
    expect(phoneOk("0408832767")).toBe(false); // not 07
    expect(phoneOk("+256708832767")).toBe(false); // the international form
    expect(phoneOk("07088a2767")).toBe(false);
  });

  it("keeps digits only, at most 10, and turns +256 into 07", () => {
    expect(toLocalPhone("0708 832-767")).toBe("0708832767");
    expect(toLocalPhone("070883276712345")).toBe("0708832767");
    expect(toLocalPhone("+256 708 832767")).toBe("0708832767");
    expect(PHONE_DIGITS).toBe(10);
  });
});

describe("toSubmission", () => {
  it("builds the HotspotSubmissionRequest body", () => {
    expect(toSubmission(filled)).toEqual({
      name: "Kigungu Lodge",
      type: "Lodge",
      region_id: filled.regionId,
      district_id: filled.districtId,
      subcounty_id: filled.subcountyId,
      village: "Kigungu",
      latitude: 0.0512,
      longitude: 32.4421,
      contact_person_name: "Sarah Nakirya",
      contact_person_phone: "0772123456",
      has_condom_dispenser: true,
      dispenser_condition: "Good",
      comment: null,
    });
  });

  it("sends the typed type for Other, and no condition without a dispenser", () => {
    const b = toSubmission({
      ...filled,
      type: OTHER_TYPE,
      otherType: " Hair salon ",
      dispenser: "no",
      village: "",
    });
    expect(b.type).toBe("Hair salon");
    expect(b.has_condom_dispenser).toBe(false);
    expect(b.dispenser_condition).toBeNull();
    expect(b.village).toBeNull();
  });
});

describe("submitErrorMessage", () => {
  const err = (status?: number) =>
    new AxiosError("x", "x", undefined, null, status ? ({ status } as never) : undefined);
  it("explains a duplicate name", () => {
    expect(submitErrorMessage(err(409))).toMatch(/already registered/);
  });
  it("explains mismatched places", () => {
    expect(submitErrorMessage(err(422))).toMatch(/region, district and sub-county/);
  });
  it("says it will retry offline", () => {
    expect(submitErrorMessage(err())).toMatch(/back online/);
  });
});

describe("toLocalHotspot", () => {
  it("keeps the API id and review status", () => {
    const res: ApiHotspot = {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Kigungu Lodge",
      type: "Lodge",
      village: "Kigungu",
      region: { id: "r", name: "Central" },
      district: { id: "d", name: "Wakiso" },
      subcounty: { id: "s", name: "Entebbe Municipality" },
      latitude: 0.05,
      longitude: 32.44,
      has_condom_dispenser: true,
      dispenser_condition: "Good",
      status: "inactive",
      review_status: "submitted",
      submitted_by_id: "55555555-5555-4555-8555-555555555555",
      contact_person: { id: "c", name: "Sarah Nakirya", phone_number: "+256772123456" },
      created_at: "2026-11-21T09:00:00Z",
    };
    expect(toLocalHotspot(res, "Grace Achieng", "Busy on weekends")).toMatchObject({
      id: res.id,
      status: "Inactive",
      reviewStatus: "submitted",
      district: "Wakiso",
      subcounty: "Entebbe Municipality",
      contact: "Sarah Nakirya",
      vhts: ["Grace Achieng"],
      comment: "Busy on weekends",
    });
  });
});
