package reports

import (
	"strings"
	"testing"
	"time"
)

func kampalaDay(s string) time.Time {
	t, err := time.ParseInLocation(time.DateOnly, s, Kampala)
	if err != nil {
		panic(err)
	}
	return t
}

func TestTrendBucketsCoverThePeriod(t *testing.T) {
	cases := []struct {
		from, to, interval string
		want               []string
	}{
		// to is exclusive: the day after the last day in the period.
		{"2026-01-15", "2026-04-01", IntervalMonth, []string{"2026-01-01", "2026-02-01", "2026-03-01"}},
		// Weeks start on Monday; 2026-11-04 is a Wednesday.
		{"2026-11-04", "2026-11-17", IntervalWeek, []string{"2026-11-02", "2026-11-09", "2026-11-16"}},
		{"2026-11-22", "2026-11-25", IntervalDay, []string{"2026-11-22", "2026-11-23", "2026-11-24"}},
		// A Sunday belongs to the week that started the Monday before.
		{"2026-11-22", "2026-11-23", IntervalWeek, []string{"2026-11-16"}},
	}
	for _, c := range cases {
		got, err := TrendBuckets(kampalaDay(c.from), kampalaDay(c.to), c.interval)
		if err != nil {
			t.Fatalf("%s %s..%s: %v", c.interval, c.from, c.to, err)
		}
		if strings.Join(got, ",") != strings.Join(c.want, ",") {
			t.Errorf("%s %s..%s = %v, want %v", c.interval, c.from, c.to, got, c.want)
		}
	}
}

func TestTrendBucketsRefusesBadIntervalsAndHugeSpans(t *testing.T) {
	if _, err := TrendBuckets(kampalaDay("2026-01-01"), kampalaDay("2026-02-01"), "year"); err == nil {
		t.Error("an unknown interval was accepted")
	}
	if _, err := TrendBuckets(kampalaDay("2020-01-01"), kampalaDay("2026-01-01"), IntervalDay); err == nil {
		t.Error("six years of days were accepted")
	}
}

func TestDefaultIntervalWidensWithThePeriod(t *testing.T) {
	cases := map[string]string{"2026-11-25": IntervalDay, "2026-12-31": IntervalWeek, "2027-06-01": IntervalMonth}
	for to, want := range cases {
		if got := DefaultInterval(kampalaDay("2026-11-01"), kampalaDay(to)); got != want {
			t.Errorf("2026-11-01..%s = %s, want %s", to, got, want)
		}
	}
}

func TestUnrequestedDispatchesMirrorTheRequestScope(t *testing.T) {
	if !strings.Contains(unrequestedCTE, "AND o.unrequested AND") || strings.Contains(unrequestedCTE, "NOT o.unrequested") {
		t.Fatal("unrequestedCTE does not select district dispatches")
	}
	if strings.Replace(unrequestedCTE, "AND o.unrequested AND", "AND NOT o.unrequested AND", 1) != requestsCTE {
		t.Fatal("unrequestedCTE differs from requestsCTE in more than the unrequested filter")
	}
}
