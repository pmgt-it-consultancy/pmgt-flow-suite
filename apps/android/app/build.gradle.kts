import java.util.Properties

plugins {
    id("app.cash.sqldelight")
    id("com.android.application")
    id("com.google.firebase.crashlytics")
    id("com.google.gms.google-services")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}
val local = Properties().apply { rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) } }

/** Gradle property first so CI can inject secrets, then local.properties for a workstation. */
fun secret(name: String): String? =
    providers.gradleProperty(name).orNull ?: local.getProperty(name)?.takeIf { it.isNotBlank() }

// Each variant talks to its own backend. CONVEX_URL remains the development fallback so an
// existing local.properties keeps working untouched.
val convexDev = secret("CONVEX_URL_DEVELOPMENT") ?: secret("CONVEX_URL") ?: ""
val convexStaging = secret("CONVEX_URL_STAGING") ?: convexDev
val convexProduction = secret("CONVEX_URL_PRODUCTION") ?: ""

fun com.android.build.api.dsl.VariantDimension.convex(url: String) =
    buildConfigField("String", "CONVEX_URL", "\"${url.replace("\\", "\\\\").replace("\"", "\\\"")}\"")
android {
    namespace = "com.pmgt.pos"
    compileSdk = 36
    defaultConfig {
        // Its own identity: this ships beside the React Native app rather than replacing it, so it
        // must never share that application id.
        applicationId = "com.pmgt.pos"
        minSdk = 26
        targetSdk = 36
        // Own version line. versionCode is MMmmpp, so 1.3.0 -> 10300.
        versionCode = 10300
        versionName = "1.3.0"
        buildConfigField("String", "UPDATE_VERSION", "\"1.3.0\"")
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    // Telemetry writes to logcat on every caught failure, so host tests need android.util.Log to
    // no-op rather than throw. Only calls that would already have thrown are affected.
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
    // Present only when a keystore is supplied (CI, or a workstation that has one). Without it
    // staging falls back to the debug key and release stays unsigned, which is what a local
    // verification build wants.
    val keystoreFile = secret("KEYSTORE_FILE")?.let { file(it) }?.takeIf { it.exists() }
    signingConfigs {
        if (keystoreFile != null) {
            create("upload") {
                storeFile = keystoreFile
                storePassword = secret("KEYSTORE_PASSWORD")
                keyAlias = secret("KEY_ALIAS")
                keyPassword = secret("KEY_PASSWORD")
            }
        }
    }
    val uploadSigning = signingConfigs.findByName("upload")

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-dev"
            buildConfigField("String", "UPDATE_VARIANT", "\"development\"")
            convex(convexDev)
        }
        // Installs beside production on the same tablet, so staging can be exercised on real
        // hardware without disturbing a live till.
        create("staging") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".stg"
            versionNameSuffix = "-staging"
            isDebuggable = false
            matchingFallbacks += listOf("debug")
            buildConfigField("String", "UPDATE_VARIANT", "\"staging\"")
            convex(convexStaging)
            signingConfig = uploadSigning ?: signingConfigs.getByName("debug")
        }
        release {
            isMinifyEnabled = false
            buildConfigField("String", "UPDATE_VARIANT", "\"production\"")
            convex(convexProduction)
            uploadSigning?.let { signingConfig = it }
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
    sourceSets.getByName("test").java.srcDir("src/sharedTest/java")
    sourceSets.getByName("androidTest").java.srcDir("src/sharedTest/java")
}
dependencies {
    implementation("app.cash.sqldelight:android-driver:2.1.0")
    testImplementation("app.cash.sqldelight:sqlite-driver:2.1.0")
    implementation(platform("androidx.compose:compose-bom:2025.09.01"))
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.9.4")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-analytics")
    implementation("com.google.firebase:firebase-crashlytics")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.10.2")
    androidTestImplementation(platform("androidx.compose:compose-bom:2025.09.01"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
}
sqldelight {
    databases {
        create("LegacyDatabase") {
            packageName.set("com.pmgt.pos.db.generated")
        }
    }
}
