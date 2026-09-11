import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { registerDevice, syncPull, syncPush } from "./sync";
import {
  syncV2Capabilities,
  syncV2HistoryOrder,
  syncV2HistorySearch,
  syncV2Pull,
  syncV2Snapshot,
} from "./syncV2";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({ path: "/sync/registerDevice", method: "POST", handler: registerDevice });
http.route({ path: "/sync/pull", method: "POST", handler: syncPull });
http.route({ path: "/sync/push", method: "POST", handler: syncPush });
http.route({ path: "/sync/v2/capabilities", method: "POST", handler: syncV2Capabilities });
http.route({ path: "/sync/v2/snapshot", method: "POST", handler: syncV2Snapshot });
http.route({ path: "/sync/v2/pull", method: "POST", handler: syncV2Pull });
http.route({ path: "/sync/v2/history/search", method: "POST", handler: syncV2HistorySearch });
http.route({ path: "/sync/v2/history/order", method: "POST", handler: syncV2HistoryOrder });

export default http;
