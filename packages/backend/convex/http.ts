import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { registerDevice, syncPull, syncPush } from "./sync";

const http = httpRouter();

auth.addHttpRoutes(http);

http.route({ path: "/sync/registerDevice", method: "POST", handler: registerDevice });
http.route({ path: "/sync/pull", method: "POST", handler: syncPull });
http.route({ path: "/sync/push", method: "POST", handler: syncPush });

export default http;
