package com.pmgt.pos

import android.app.Application
import android.os.Bundle
import android.view.MotionEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.lifecycle.lifecycleScope
import com.pmgt.pos.auth.*
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.launch

class PosApplication : Application() {
    val http by lazy { ConvexHttp(BuildConfig.CONVEX_URL) }
    val auth by lazy { AuthRepository(http, AndroidSessionStorage(this)) }
    val lock by lazy { LockState(AndroidLockStorage(this), http) }
}

class MainActivity : ComponentActivity() {
    private val services get() = application as PosApplication
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { PosAuthShell(services.auth, services.lock, services.http) }
    }
    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) services.lock.resetActivity()
        return super.dispatchTouchEvent(event)
    }
    override fun onStop() { services.lock.onBackground(); super.onStop() }
    override fun onStart() {
        super.onStart()
        lifecycleScope.launch { services.auth.state.value.user?.let { services.lock.onForeground(it) } }
    }
}
