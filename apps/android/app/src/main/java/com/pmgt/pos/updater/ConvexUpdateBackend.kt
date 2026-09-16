package com.pmgt.pos.updater

import com.pmgt.pos.transport.ConvexHttp
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

class ConvexUpdateBackend(private val http: ConvexHttp) : UpdateBackend {
    override suspend fun check(currentVersion: String, variant: String): UpdateCheckResult {
        val value =
            http
                .action(
                    "appUpdate:checkForUpdate",
                    buildJsonObject {
                        put("currentVersion", currentVersion)
                        put("variant", variant)
                        // Never accept the React Native app's APK; it is a different package.
                        put("product", "kotlin")
                    },
                )
                .jsonObject
        if (value.getValue("updateAvailable").jsonPrimitive.boolean.not()) {
            return UpdateCheckResult.None
        }
        return UpdateCheckResult.Available(
            UpdateInfo(
                latestVersion = value.getValue("latestVersion").jsonPrimitive.content,
                assetUrl = value.getValue("downloadUrl").jsonPrimitive.content,
                releaseNotes = value["releaseNotes"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                isForced = value.getValue("isForced").jsonPrimitive.boolean,
            )
        )
    }

    override suspend fun resolveDownloadUrl(assetUrl: String): String =
        http
            .action(
                "appUpdate:getApkDownloadUrl",
                buildJsonObject { put("assetUrl", assetUrl) },
            )
            .jsonPrimitive
            .content
}
