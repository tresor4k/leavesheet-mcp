// Golden generator for the pto package (copied into a temporary module by
// gen-golden.mjs). Reads pto_accrual tool inputs as a JSON array (file in
// argument 1) and prints, per case, one compact JSON line
// {"balance":...,"request_days":[...]} computed by the Go engine. The last
// line holds USFederalHolidays for the years given after the file.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	"codeberg.org/tresor2k/tabletemplates-go/pto"
)

type input struct {
	Policy struct {
		Period       string  `json:"period"`
		Rate         float64 `json:"rate"`
		AnnualCap    float64 `json:"annual_cap"`
		CarryoverMax float64 `json:"carryover_max"`
		Tier1Years   float64 `json:"tier1_years"`
		Tier1Bonus   float64 `json:"tier1_bonus"`
		Tier2Years   float64 `json:"tier2_years"`
		Tier2Bonus   float64 `json:"tier2_bonus"`
	} `json:"policy"`
	HireDate  string  `json:"hire_date"`
	AsOf      string  `json:"as_of"`
	Carryover float64 `json:"carryover"`
	Requests  []struct {
		Start     string `json:"start"`
		End       string `json:"end"`
		StartHalf bool   `json:"start_half"`
		EndHalf   bool   `json:"end_half"`
		Status    string `json:"status"`
	} `json:"requests"`
	Holidays []string `json:"holidays"`
	FedYears []int    `json:"us_federal_holidays_years"`
}

type balance struct {
	MonthsWorked   int     `json:"months_worked"`
	YearsOfService float64 `json:"years_of_service"`
	EffectiveRate  float64 `json:"effective_rate"`
	Accrued        float64 `json:"accrued"`
	Carryover      float64 `json:"carryover"`
	Taken          float64 `json:"taken"`
	Pending        float64 `json:"pending"`
	Left           float64 `json:"left"`
	IsNegative     bool    `json:"is_negative"`
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
}

func date(s string) time.Time {
	t, err := time.Parse("2006-01-02", s)
	must(err)
	return t
}

var statuses = map[string]pto.Status{"pending": pto.Pending, "approved": pto.Approved, "denied": pto.Denied, "cancelled": pto.Cancelled}

func main() {
	var cases []input
	data, err := os.ReadFile(os.Args[1])
	must(err)
	must(json.Unmarshal(data, &cases))
	for i, c := range cases {
		cp := c.Policy
		policy := pto.Policy{
			Rate: cp.Rate, AnnualCap: cp.AnnualCap, CarryoverMax: cp.CarryoverMax,
			Tier1Years: cp.Tier1Years, Tier1Bonus: cp.Tier1Bonus,
			Tier2Years: cp.Tier2Years, Tier2Bonus: cp.Tier2Bonus,
		}
		switch c.Policy.Period {
		case "monthly":
			policy.Period = pto.Monthly
		case "annual":
			policy.Period = pto.Annual
		default:
			must(fmt.Errorf("case %d: bad period %q", i, c.Policy.Period))
		}
		var hol []time.Time
		for _, h := range c.Holidays {
			hol = append(hol, date(h))
		}
		for _, y := range c.FedYears {
			for _, h := range pto.USFederalHolidays(y) {
				hol = append(hol, h.Date)
			}
		}
		reqs := []pto.Request{}
		days := []float64{}
		for _, r := range c.Requests {
			st, ok := statuses[r.Status]
			if !ok {
				must(fmt.Errorf("case %d: bad status %q", i, r.Status))
			}
			q := pto.Request{Start: date(r.Start), End: date(r.End), StartHalf: r.StartHalf, EndHalf: r.EndHalf, Status: st}
			reqs = append(reqs, q)
			days = append(days, pto.RequestDays(q, hol))
		}
		b := pto.ComputeBalance(policy, pto.Employee{HireDate: date(c.HireDate), Carryover: c.Carryover}, reqs, hol, date(c.AsOf))
		out, err := json.Marshal(struct {
			Balance     balance   `json:"balance"`
			RequestDays []float64 `json:"request_days"`
		}{balance(b), days})
		must(err)
		fmt.Println(string(out))
	}
	type hol struct {
		Date string `json:"date"`
		Name string `json:"name"`
	}
	all := map[string][]hol{}
	for _, a := range os.Args[2:] {
		y, err := strconv.Atoi(a)
		must(err)
		for _, h := range pto.USFederalHolidays(y) {
			all[a] = append(all[a], hol{h.Date.Format("2006-01-02"), h.Name})
		}
	}
	out, err := json.Marshal(all)
	must(err)
	fmt.Println(string(out))
}
