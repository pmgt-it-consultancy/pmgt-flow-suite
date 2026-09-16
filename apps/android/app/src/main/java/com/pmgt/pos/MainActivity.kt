package com.pmgt.pos

import android.app.Application
import android.os.Bundle
import android.view.MotionEvent
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
import com.pmgt.pos.orders.EditorSessions
import com.pmgt.pos.orders.LocalOrderRepository
import com.pmgt.pos.sync.*
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.*
import kotlinx.coroutines.launch

class PosApplication : Application() {
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val http by lazy { ConvexHttp(BuildConfig.CONVEX_URL) }
    val auth by lazy { AuthRepository(http, AndroidSessionStorage(this)) }
    val lock by lazy { LockState(AndroidLockStorage(this), http) }
    private val network by lazy { AndroidNetwork(this, applicationScope) }
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
        startup.bind(auth.state)
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
            LaunchedEffect(authState.user?.id, authState.user?.storeId, sessionEpoch) {
                editors.clear()
            }
            val logout = remember { RootLogout(services.auth, scope) }
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
                            onRoute = { services.lock.setCurrentRoute(it) },
                            syncStatus = syncState?.status ?: SyncStatus.Idle,
                            onRetrySync = { scope.launch { sync?.syncNow() } },
                            catalogRepository =
                                remember(database) {
                                    LocalCatalogRepository(database, Dispatchers.IO)
                                },
                            entryRepository =
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
                                },
                            editorSessions = editors,
                            checkoutRepository =
                                remember(database, sync, sessionEpoch, user.id, user.storeId) {
                                    LocalCheckoutRepository(
                                        database,
                                        Dispatchers.IO,
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
                            checkoutHttp = services.http,
                            checkoutSessions = checkouts,
                            checkoutIsCurrent = {
                                services.auth.sessionEpoch.value == sessionEpoch &&
                                    services.auth.state.value.user?.id == user.id &&
                                    services.auth.state.value.user?.storeId == user.storeId
                            },
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
