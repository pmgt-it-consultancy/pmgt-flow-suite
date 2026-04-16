"use client";

import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { normalizeErrors } from "../../_shared/normalizeErrors";
import { defaultSchedule, type StoreSchedule } from "../_schemas";

type WeekdayKey = keyof StoreSchedule;

const WEEKDAY_ROWS: { key: WeekdayKey; label: string }[] = [
  { key: "monday", label: "Monday" },
  { key: "tuesday", label: "Tuesday" },
  { key: "wednesday", label: "Wednesday" },
  { key: "thursday", label: "Thursday" },
  { key: "friday", label: "Friday" },
  { key: "saturday", label: "Saturday" },
  { key: "sunday", label: "Sunday" },
];

function computeHint(open: string, close: string): string | null {
  if (open === close) {
    return open === "00:00"
      ? "Open 24 hours (midnight cutoff)"
      : `24-hour business day starting at ${open}`;
  }
  if (close < open) {
    return `Closes next day at ${close}`;
  }
  return null;
}

interface ScheduleEditorProps {
  // biome-ignore lint/suspicious/noExplicitAny: TanStack Form generics
  form: any; // TanStack form API; kept loose at the boundary
}

export function ScheduleEditor({ form }: ScheduleEditorProps) {
  const applyWeekdaysFromMonday = () => {
    const mon = form.getFieldValue("schedule.monday");
    if (!mon) return;
    for (const day of ["tuesday", "wednesday", "thursday", "friday"] as const) {
      form.setFieldValue(`schedule.${day}.open`, mon.open);
      form.setFieldValue(`schedule.${day}.close`, mon.close);
    }
  };

  const applyAllFromMonday = () => {
    const mon = form.getFieldValue("schedule.monday");
    if (!mon) return;
    for (const { key } of WEEKDAY_ROWS) {
      form.setFieldValue(`schedule.${key}.open`, mon.open);
      form.setFieldValue(`schedule.${key}.close`, mon.close);
    }
  };

  const resetTo24h = () => {
    for (const { key } of WEEKDAY_ROWS) {
      form.setFieldValue(`schedule.${key}.open`, defaultSchedule[key].open);
      form.setFieldValue(`schedule.${key}.close`, defaultSchedule[key].close);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-gray-500">
        Closing time determines when orders roll over to the next business day. Use 00:00 / 00:00 to
        mean "24 hours, midnight cutoff."
      </p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={applyWeekdaysFromMonday}>
          Copy Monday to weekdays
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={applyAllFromMonday}>
          Copy Monday to all days
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={resetTo24h}>
          Reset to 24/7 (midnight cutoff)
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {WEEKDAY_ROWS.map(({ key, label }) => (
          <form.Field
            key={key}
            name={`schedule.${key}`}
            // biome-ignore lint/suspicious/noExplicitAny: TanStack Form generics
            children={(slotField: any) => {
              const { open, close } = slotField.state.value;
              const hint = computeHint(open, close);
              return (
                <div className="grid grid-cols-[120px_1fr_1fr] gap-3 items-start">
                  <div className="pt-8 text-sm font-medium">{label}</div>

                  <form.Field
                    name={`schedule.${key}.open`}
                    // biome-ignore lint/suspicious/noExplicitAny: TanStack Form generics
                    children={(field: any) => {
                      const hasErrors =
                        field.state.meta.isTouched && field.state.meta.errors.length > 0;
                      return (
                        <Field data-invalid={hasErrors || undefined}>
                          <FieldLabel htmlFor={`schedule-${key}-open`}>Open</FieldLabel>
                          <Input
                            id={`schedule-${key}-open`}
                            type="time"
                            aria-invalid={hasErrors || undefined}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                          />
                          <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                        </Field>
                      );
                    }}
                  />

                  <form.Field
                    name={`schedule.${key}.close`}
                    // biome-ignore lint/suspicious/noExplicitAny: TanStack Form generics
                    children={(field: any) => {
                      const hasErrors =
                        field.state.meta.isTouched && field.state.meta.errors.length > 0;
                      return (
                        <Field data-invalid={hasErrors || undefined}>
                          <FieldLabel htmlFor={`schedule-${key}-close`}>Close</FieldLabel>
                          <Input
                            id={`schedule-${key}-close`}
                            type="time"
                            aria-invalid={hasErrors || undefined}
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            onBlur={field.handleBlur}
                          />
                          {hint && <p className="text-xs text-gray-500">{hint}</p>}
                          <FieldError errors={normalizeErrors(field.state.meta.errors)} />
                        </Field>
                      );
                    }}
                  />
                </div>
              );
            }}
          />
        ))}
      </div>
    </div>
  );
}
