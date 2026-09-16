package com.pmgt.pos

import android.app.Application
import android.os.Bundle
import android.view.MotionEvent
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import com.pmgt.pos.auth.*
import com.pmgt.pos.browse.*
import com.pmgt.pos.catalog.LocalCatalogRepository
import com.pmgt.pos.checkout.*
import com.pmgt.pos.db.AndroidDatabase
import com.pmgt.pos.db.DeviceIdentity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import com.pmgt.pos.closing.ClosingController
import com.pmgt.pos.closing.HttpClosingRepository
import com.pmgt.pos.orders.EditorSessions
import com.pmgt.pos.printer.platform.AndroidPrinterBluetoothPlatform
import com.pmgt.pos.printer.platform.AndroidPrinterDeviceManager
import com.pmgt.pos.printer.platform.BluetoothEnableResult
import com.pmgt.pos.printer.platform.ClassicBluetoothPrinterTransport
import com.pmgt.pos.printer.platform.PrinterConnectionEffects
import com.pmgt.pos.printer.settings.AndroidPrinterSettingsDeviceAccess
import com.pmgt.pos.printer.settings.AndroidPrinterSettingsPersistence
import com.pmgt.pos.printer.settings.ClassicBluetoothPrinterSettingsTransport
import com.pmgt.pos.printer.settings.PrinterSettingsController
import com.pmgt.pos.settings.ConvexSettingsServer
import com.pmgt.pos.settings.SettingsController
import com.pmgt.pos.updater.ConvexUpdateBackend
import com.pmgt.pos.updater.UpdateCoordinator
import com.pmgt.pos.updater.platform.AndroidUpdateInstaller
import com.pmgt.pos.updater.platform.AndroidUpdateNotifier
import com.pmgt.pos.updater.platform.AndroidUpdateTransferPlatform
import com.pmgt.pos.orders.LocalOrderRepository
import com.pmgt.pos.sync.*
import com.pmgt.pos.telemetry.FirebaseTelemetry
import com.pmgt.pos.telemetry.Telemetry
import com.pmgt.pos.telemetry.reportTabletContext
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class PosApplication : Application() {
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val http by lazy { ConvexHttp(BuildConfig.CONVEX_URL) }
    val auth by lazy { AuthRepository(http, AndroidSessionStorage(this)) }
    val lock by lazy { LockState(AndroidLockStorage(this), http) }
    private val network by lazy { AndroidNetwork(this, applicationScope) }
    val online by lazy { network.online.stateIn(applicationScope, SharingStarted.Eagerly, false) }
    val startup by lazy {
        TabletStartup(
            {
                val database = AndroidDatabase.open(this)
                AdoptedStorage(database, DeviceIdentity.readOrCreate(this, adopting = true))
            },
            http,
            applicationScope,
            Dispatchers.IO,
            network.online,
        )
    }

    override fun onCreate() {
        super.onCreate()
        Telemetry.install(FirebaseTelemetry(this))
        Telemetry.key("build_variant", BuildConfig.UPDATE_VARIANT)
        Telemetry.key("app_version", BuildConfig.UPDATE_VERSION)
        startup.bind(auth.state)
        applicationScope.launch { startup.state.collect { reportTabletContext(it, startup.deviceId) } }
    }
}

class MainActivity : ComponentActivity() {
    private val services
        get() = application as PosApplication

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(android.graphics.Color.rgb(13, 135, 225)),
            navigationBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT),
        )
        // A till must not sleep during service. This keeps the display on while the app is in
        // the foreground; the in-app auto-lock still locks the session on its own timer.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
            hide(WindowInsetsCompat.Type.navigationBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        setContent {
            val holder = rememberSaveableStateHolder()
            val scope = rememberCoroutineScope()
            val editors = remember { EditorSessions(scope) }
            val authState by services.auth.state.collectAsStateWithLifecycle()
            val sessionEpoch by services.auth.sessionEpoch.collectAsStateWithLifecycle()
            val checkouts = remember(sessionEpoch) { CheckoutSessions(scope) }
            DisposableEffect(checkouts) { onDispose { checkouts.clear() } }
            val corrections = remember(sessionEpoch) { CorrectionSessions(scope) }
            DisposableEffect(corrections) { onDispose { corrections.clear() } }
            LaunchedEffect(authState.user?.id, authState.user?.storeId, sessionEpoch) {
                editors.clear()
            }
            val logout = remember { RootLogout(services.auth, scope) }
            var enablePrompt by remember { mutableStateOf<CompletableDeferred<Boolean>?>(null) }
            var permissionPrompt by remember { mutableStateOf<CompletableDeferred<Boolean>?>(null) }
            val enableLauncher =
                rememberLauncherForActivityResult(
                    ActivityResultContracts.StartActivityForResult()
                ) { result ->
                    enablePrompt?.complete(
                        AndroidPrinterBluetoothPlatform.enableResult(result.resultCode) ==
                            BluetoothEnableResult.Accepted
                    )
                    enablePrompt = null
                }
            val permissionLauncher =
                rememberLauncherForActivityResult(
                    ActivityResultContracts.RequestMultiplePermissions()
                ) { grants ->
                    permissionPrompt?.complete(grants.values.all { it })
                    permissionPrompt = null
                }
            val bluetoothPlatform =
                remember { AndroidPrinterBluetoothPlatform(applicationContext) }
            val printers =
                remember {
                    PrinterSettingsController(
                        AndroidPrinterSettingsPersistence(applicationContext),
                        ClassicBluetoothPrinterSettingsTransport(
                            ClassicBluetoothPrinterTransport(bluetoothPlatform, Dispatchers.IO),
                            AndroidPrinterSettingsDeviceAccess(
                                AndroidPrinterDeviceManager(applicationContext),
                                requestEnable = {
                                    val prompt = CompletableDeferred<Boolean>()
                                    // A superseded prompt never receives its own result, so
                                    // release it rather than leaving its caller suspended.
                                    enablePrompt?.complete(false)
                                    enablePrompt = prompt
                                    enableLauncher.launch(
                                        AndroidPrinterBluetoothPlatform.requestEnableIntent()
                                    )
                                    if (prompt.await()) BluetoothEnableResult.Accepted
                                    else BluetoothEnableResult.RefusedOrError
                                },
                                requestPermissions = {
                                    val missing = bluetoothPlatform.requiredPermissionNames()
                                    val prompt = CompletableDeferred<Boolean>()
                                    permissionPrompt?.complete(false)
                                    permissionPrompt = prompt
                                    permissionLauncher.launch(missing)
                                    prompt.await()
                                },
                            ),
                        ),
                    )
                }
            PosAuthShell(services.auth, services.lock, services.http, startup = services.startup) {
                user ->
                val database = services.startup.database
                val sync by services.startup.sync.collectAsStateWithLifecycle()
                if (database != null && user.storeId != null)
                    holder.SaveableStateProvider("${user.id}:${user.storeId}:$sessionEpoch") {
                        val repository =
                            remember(database) { LocalBrowseRepository(database, Dispatchers.IO) }
                        val dashboard =
                            remember(user.storeId, sync) {
                                DashboardSource(services.http)
                                    .observe(
                                        user.storeId,
                                        sync
                                            ?.state
                                            ?.map { it.lastPulledAt }
                                            ?.distinctUntilChanged()
                                            ?.drop(1) ?: emptyFlow(),
                                    )
                            }
                        val syncState = sync?.state?.collectAsStateWithLifecycle()?.value
                        val deviceCode =
                            sync?.deviceCode?.collectAsStateWithLifecycle()?.value.orEmpty()
                        val lockState by services.lock.state.collectAsStateWithLifecycle()
                        val entry =
                            remember(database, sync) {
                                LocalOrderRepository(
                                    database,
                                    Dispatchers.IO,
                                    {
                                        DeviceIdentity.readOrCreate(
                                            applicationContext,
                                            adopting = true,
                                        )
                                    },
                                    { sync?.deviceCode?.value.orEmpty() },
                                    { sync?.triggerPush() },
                                )
                            }
                        val checkoutRepository =
                            remember(database, sync, sessionEpoch, user.id, user.storeId) {
                                LocalCheckoutRepository(
                                    database,
                                    Dispatchers.IO,
                                    {
                                        services.auth.state.value.user
                                            ?.takeIf {
                                                services.auth.sessionEpoch.value == sessionEpoch &&
                                                    it.id == user.id &&
                                                    it.storeId == user.storeId
                                            }
                                            ?.let {
                                                CheckoutOwner(it.id, requireNotNull(it.storeId))
                                            }
                                    },
                                    { sync?.triggerPush() },
                                )
                            }
                        val sessionIsCurrent = {
                            services.auth.sessionEpoch.value == sessionEpoch &&
                                services.auth.state.value.user?.id == user.id &&
                                services.auth.state.value.user?.storeId == user.storeId
                        }
                        val activeSync = sync
                        // Settings, closing and updates are session scoped; the printer stack is
                        // device scoped, exactly as the source keeps its global printer store.
                        val modules =
                            if (activeSync == null) null
                            else
                                remember(activeSync, sessionEpoch, user.id, user.storeId) {
                                    PosModules(
                                        settings =
                                            SettingsController(
                                                services.auth,
                                                services.lock,
                                                activeSync,
                                                checkoutRepository,
                                                printers,
                                                ConvexSettingsServer(services.http),
                                                adoptedDeviceId =
                                                    DeviceIdentity.readOrCreate(
                                                        applicationContext,
                                                        adopting = true,
                                                    ),
                                                displayVersion = BuildConfig.UPDATE_VERSION,
                                                scope = scope,
                                            ),
                                        printers = printers,
                                        closing =
                                            ClosingController(
                                                HttpClosingRepository(services.http),
                                                checkoutRepository,
                                                syncForDelivery = activeSync::syncForDelivery,
                                                printCalls = printers::printReceiptCalls,
                                                charsPerLine = printers::receiptCharsPerLine,
                                                online = services.online,
                                                scope = scope,
                                                sessionIsCurrent = sessionIsCurrent,
                                            ),
                                        updates =
                                            UpdateCoordinator(
                                                ConvexUpdateBackend(services.http),
                                                AndroidUpdateTransferPlatform(
                                                    applicationContext,
                                                    scope,
                                                ),
                                                AndroidUpdateInstaller(applicationContext),
                                                AndroidUpdateNotifier(applicationContext),
                                                currentVersion = BuildConfig.UPDATE_VERSION,
                                                variant = BuildConfig.UPDATE_VARIANT,
                                                scope = scope,
                                            ),
                                        currentVersion = BuildConfig.UPDATE_VERSION,
                                    )
                                }
                        // Source initializes the printer store once the operational stack mounts.
                        LaunchedEffect(printers) { printers.initialize() }
                        PrinterConnectionEffects(printers, scope)
                        PosBrowseRoot(
                            user,
                            repository,
                            dashboard,
                            syncLabel = browseSyncLabel(syncState, deviceCode),
                            hasPin = lockState.pinUserId == user.id && lockState.userHasPin,
                            onLock = { scope.launch { services.lock.lock(user) } },
                            onLogout = {
                                logout {
                                    holder.removeState("${user.id}:${user.storeId}:$sessionEpoch")
                                }
                            },
                            refreshHistory = {
                                sync?.syncForDelivery()
                                Unit
                            },
                            onRoute = {
                                services.lock.setCurrentRoute(it)
                                Telemetry.screen(it)
                            },
                            syncStatus = syncState?.status ?: SyncStatus.Idle,
                            onRetrySync = {
                                sync?.let { manager ->
                                    Telemetry.event("sync_now")
                                    scope.launch { manager.syncNow() }
                                }
                            },
                            catalogRepository =
                                remember(database) {
                                    LocalCatalogRepository(database, Dispatchers.IO)
                                },
                            entryRepository = entry,
                            editorSessions = editors,
                            checkoutRepository = checkoutRepository,
                            modules = modules,
                            checkoutHttp = services.http,
                            correctionRepository =
                                remember(database, sync, sessionEpoch, user.id, user.storeId) {
                                    LocalCorrectionRepository(
                                        database,
                                        Dispatchers.IO,
                                        entry,
                                        {
                                            services.auth.state.value.user
                                                ?.takeIf {
                                                    services.auth.sessionEpoch.value ==
                                                        sessionEpoch &&
                                                        it.id == user.id &&
                                                        it.storeId == user.storeId
                                                }
                                                ?.let {
                                                    CheckoutOwner(it.id, requireNotNull(it.storeId))
                                                }
                                        },
                                        { sync?.triggerPush() },
                                    )
                                },
                            reprintAudit =
                                remember(database) {
                                    HttpReprintAudit(database, Dispatchers.IO, services.http)
                                },
                            correctionSessions = corrections,
                            checkoutSessions = checkouts,
                            checkoutIsCurrent = sessionIsCurrent,
                        )
                    }
            }
        }
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) services.lock.resetActivity()
        return super.dispatchTouchEvent(event)
    }

    override fun onStop() {
        services.lock.onBackground()
        super.onStop()
    }

    override fun onStart() {
        super.onStart()
        WindowCompat.getInsetsController(window, window.decorView)
            .hide(WindowInsetsCompat.Type.navigationBars())
        lifecycleScope.launch { services.lock.onForeground(services.auth.state.value.user) }
    }
}
