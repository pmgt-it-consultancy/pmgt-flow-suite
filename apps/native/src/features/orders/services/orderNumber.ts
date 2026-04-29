import { getOrCreateDeviceId } from "../../../auth/deviceId";
import { getDatabase } from "../../../db";
import { generateUUID } from "../../../sync/idBridge";
import { syncManager } from "../../../sync/SyncManager";

function uid(): string {
  return generateUUID();
}

export async function getNextOrderNumber(
  _storeId: string,
  orderType: "dine_in" | "takeout",
): Promise<string> {
  const prefix = orderType === "dine_in" ? "D" : "T";
  const deviceCode = syncManager.getDeviceCode() || (await getFallbackDeviceCode());
  const today = getTodayKey();

  const counterKey = `orderCounter.${orderType}.${today}`;
  const next = await incrementCounter(counterKey);

  const padded = String(next).padStart(3, "0");
  return `${prefix}-${deviceCode}${padded}`;
}

async function getFallbackDeviceCode(): Promise<string> {
  const deviceId = await getOrCreateDeviceId();
  return (
    deviceId
      .replace(/[^a-z0-9]/gi, "")
      .slice(0, 4)
      .toUpperCase() || "X"
  );
}

function getTodayKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function incrementCounter(key: string): Promise<number> {
  const db = getDatabase();
  let nextValue = 1;

  await db.write(async () => {
    const allConfig = await db.get("app_config").query().fetch();
    const configRow = allConfig.find((r: any) => r.key === key);

    if (configRow) {
      const current = parseInt((configRow as any).value, 10) || 0;
      nextValue = current + 1;
      await configRow.update((r: any) => {
        r.value = String(nextValue);
      });
    } else {
      await db.get("app_config").create((r: any) => {
        r._raw.id = uid();
        r.key = key;
        r.value = String(nextValue);
      });
    }
  });

  return nextValue;
}
