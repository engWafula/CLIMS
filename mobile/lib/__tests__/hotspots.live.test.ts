/**
 * Submits a hotspot to a running CLIMS backend with the app's own client code, end to end:
 * sign in, load the place lists, validate the form, POST /hotspots, then retry the same name.
 *
 * Skipped unless CLIMS_LIVE_API is set. Use a development database: it creates a real hotspot.
 *
 *   CLIMS_LIVE_API=http://localhost:8080/api/v1 CLIMS_LIVE_LOGIN=<vht login> \
 *   CLIMS_LIVE_PASSWORD=<password> npx jest lib/__tests__/hotspots.live --watchAll=false
 *
 * The account needs the vht role, and the role needs hotspots:read and hotspots:submit
 * (an administrator grants them on the web app's Roles page).
 */
import { isAxiosError } from "axios";
import { api, login, setTokens, toStoredTokens, tokenClient } from "../api";
import {
  listDistricts,
  listRegions,
  listHotspotsPage,
  listSubcounties,
  submitErrorMessage,
  submitHotspot,
  toLocalHotspot,
  toSubmission,
  validateMapForm,
  type MapForm,
} from "../hotspots";
import { appRoleOf } from "../session";

const mockMemory = new Map<string, string>();
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: async (k: string) => mockMemory.get(k) ?? null,
  setItem: async (k: string, v: string) => void mockMemory.set(k, v),
}));
jest.mock("expo-secure-store", () => ({}));

const BASE = process.env.CLIMS_LIVE_API;
const live = BASE ? describe : describe.skip;

live("hotspot submission against a running backend", () => {
  jest.setTimeout(60_000);
  let form: MapForm;

  beforeAll(async () => {
    for (const c of [api, tokenClient]) {
      c.defaults.baseURL = BASE!.replace(/\/$/, "");
      c.defaults.adapter = "http";
    }
    const res = await login(
      process.env.CLIMS_LIVE_LOGIN ?? "",
      process.env.CLIMS_LIVE_PASSWORD ?? "",
    );
    expect(appRoleOf(res.user)).toBe("vht");
    setTokens(toStoredTokens(res));
  });

  afterAll(() => setTokens(null));

  it("loads the region, district and sub-county lists", async () => {
    const regions = await listRegions();
    expect(regions.length).toBeGreaterThan(0);
    const region = regions.find((r) => r.name === "Central") ?? regions[0];
    const districts = await listDistricts(region.id);
    const district = districts.find((d) => d.name === "Wakiso") ?? districts[0];
    const subcounties = await listSubcounties(district.id);
    expect(subcounties.length).toBeGreaterThan(0);
    form = {
      regionId: region.id,
      districtId: district.id,
      subcountyId: subcounties[0].id,
      village: "Kigungu",
      lat: 0.0512,
      lng: 32.4421,
      name: `Mobile check ${Date.now()}`,
      type: "Lodge",
      otherType: "",
      dispenser: "yes",
      condition: "Good",
      comment: "Submitted by the mobile live check",
      contactName: "Sarah Nakirya",
      contactPhone: "0772 123 456",
    };
    expect(validateMapForm(form)).toEqual({});
  });

  it("submits the hotspot for DCFP review", async () => {
    const body = toSubmission(form);
    const res = await submitHotspot(body);
    expect(res).toMatchObject({
      name: body.name,
      type: "Lodge",
      village: "Kigungu",
      status: "inactive",
      review_status: "submitted",
      has_condom_dispenser: true,
      dispenser_condition: "Good",
      contact_person: { name: "Sarah Nakirya", phone_number: "+256772123456" },
    });
    expect(res.subcounty?.id).toBe(form.subcountyId);
    // The Hotspots tab lists it from GET /hotspots, which shows a VHT their own submissions.
    const mine = (
      await listHotspotsPage({ offset: 0, submittedBy: res.submitted_by_id ?? undefined })
    ).items;
    expect(mine.map((h) => h.id)).toContain(res.id);
    expect(mine[0].id).toBe(res.id); // most recently updated first
    expect(toLocalHotspot(res, "Grace Achieng", body.comment)).toMatchObject({
      id: res.id,
      status: "Inactive",
      reviewStatus: "submitted",
    });
  });

  it("refuses the same name in the same village, with a message the VHT can act on", async () => {
    const err = await submitHotspot(toSubmission(form)).catch((e: unknown) => e);
    expect(isAxiosError(err) && err.response?.status).toBe(409);
    expect(submitErrorMessage(err)).toMatch(/already registered/);
  });
});
