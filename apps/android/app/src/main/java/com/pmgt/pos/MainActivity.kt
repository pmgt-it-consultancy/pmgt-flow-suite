package com.pmgt.pos

import android.app.Application
import android.os.Bundle
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.setContent
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import com.pmgt.pos.auth.*
import com.pmgt.pos.db.AndroidDatabase
import com.pmgt.pos.db.DeviceIdentity
import com.pmgt.pos.sync.*
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class PosApplication : Application() {
    private val applicationScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    val http by lazy { ConvexHttp(BuildConfig.CONVEX_URL) }
    val auth by lazy { AuthRepository(http, AndroidSessionStorage(this)) }
    val lock by lazy { LockState(AndroidLockStorage(this), http) }
    private val network by lazy { AndroidNetwork(this, applicationScope) }
    val startup by lazy {
        TabletStartup({
            val database = AndroidDatabase.open(this)
            AdoptedStorage(database, DeviceIdentity.readOrCreate(this, adopting = true))
        }, http, applicationScope, Dispatchers.IO, network.online)
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
        setContent { PosAuthShell(services.auth, services.lock, services.http, startup = services.startup) }
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
        WindowCompat.getInsetsController(window, window.decorView).hide(
            WindowInsetsCompat.Type.navigationBars()
        )
        lifecycleScope.launch { services.lock.onForeground(services.auth.state.value.user) }
    }
}
