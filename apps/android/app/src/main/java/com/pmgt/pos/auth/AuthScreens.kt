package com.pmgt.pos.auth

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.pmgt.pos.BuildConfig
import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.*
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
fun PosAuthShell(auth: AuthRepository, lock: LockState, http: ConvexHttp, configured: Boolean = BuildConfig.CONVEX_URL.isNotBlank(), content: @Composable (SignedInUser) -> Unit = { SessionHome(it) }) {
    val session by auth.state.collectAsState()
    val locked by lock.state.collectAsState()
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var storeName by remember { mutableStateOf<String?>(null) }
    var hasPin by remember { mutableStateOf(false) }
    fun perform(block: suspend () -> Unit) {
        if (busy) return
        busy = true; error = null
        scope.launch {
            try { block() } catch (e: CancellationException) { throw e }
            catch (e: Exception) { error = e.message ?: "Request failed. Please try again." }
            finally { busy = false }
        }
    }
    LaunchedEffect(auth) { if (configured) auth.restore() }
    LaunchedEffect(session.user?.id) {
        val user = session.user ?: return@LaunchedEffect
        try {
            lock.configure(user); hasPin = lock.userHasPin
            storeName = user.storeId?.let { id ->
                (http.query("stores:get", buildJsonObject { put("storeId", id) }) as? JsonObject)?.optionalString("name")
            }
        } catch (_: Exception) { error = "Could not load store settings. Check your connection." }
    }
    LaunchedEffect(session.user?.id) {
        while (session.user != null) {
            delay(1000)
            session.user?.let { lock.tick(it) }
        }
    }
    LaunchedEffect(session.user?.id) {
        while (session.user != null) {
            delay(30_000)
            try { auth.reloadUser() } catch (_: Exception) { /* In-memory session survives a transient connection loss, as in RN. */ }
        }
    }
    MaterialTheme(colorScheme = lightColorScheme(primary = Color(0xFF0D87E1))) {
        Surface(Modifier.fillMaxSize()) {
            when {
                session.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                session.user == null -> LoginScreen(session.error, busy, configured) { email, password ->
                    perform { try { auth.signIn(email, password) } catch (_: Exception) { /* Friendly error supplied by repository. */ } }
                }
                locked.snapshot.isLocked -> LockScreen(lock, session.user!!, http, busy, error) { store, pin, manager ->
                    perform { error = lock.unlock(store, pin, manager) }
                }
                else -> Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Column(Modifier.weight(1f)) {
                            Text(storeName ?: "PMGT Flow", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.Bold)
                            Text("${session.user!!.name} · ${session.user!!.role?.name ?: "No role assigned"}")
                        }
                        Button(onClick = { perform { lock.lock(session.user!!) } }, enabled = hasPin && !busy, modifier = Modifier.heightIn(min = 56.dp)) { Text("Lock screen") }
                        OutlinedButton(onClick = { perform { auth.signOut() } }, enabled = !busy, modifier = Modifier.heightIn(min = 56.dp)) { Text("Sign out") }
                    }
                    if (locked.showIdleWarning) Surface(color = Color(0xFFFEF3C7)) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("Screen will lock in 30 seconds", Modifier.weight(1f))
                            Button(onClick = lock::resetActivity) { Text("Keep working") }
                        }
                    }
                    error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    content(session.user!!)
                }
            }
        }
    }
}

@Composable private fun LoginScreen(error: String?, busy: Boolean, configured: Boolean, signIn: (String, String) -> Unit) {
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    Row(Modifier.fillMaxSize().padding(32.dp), horizontalArrangement = Arrangement.spacedBy(40.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text("PMGT Flow", style = MaterialTheme.typography.displayMedium, fontWeight = FontWeight.Bold)
            Text("Sign in to your store", style = MaterialTheme.typography.headlineSmall)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            OutlinedTextField(email, { email = it }, label = { Text("Email") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth())
            OutlinedTextField(password, { password = it }, label = { Text("Password") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password), modifier = Modifier.fillMaxWidth())
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            if (!configured) Text("Set CONVEX_URL in local.properties and rebuild to connect this app.", color = MaterialTheme.colorScheme.error)
            Button(onClick = { signIn(email.trim(), password); password = "" }, enabled = configured && !busy && email.isNotBlank() && password.isNotBlank(), modifier = Modifier.fillMaxWidth().height(56.dp)) { Text(if (busy) "Signing in…" else "Sign in") }
        }
    }
}

@Composable private fun LockScreen(lock: LockState, user: SignedInUser, http: ConvexHttp, busy: Boolean, error: String?, unlock: (String, String, String?) -> Unit) {
    val locked by lock.state.collectAsState()
    var pin by remember { mutableStateOf("") }
    var time by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var override by remember { mutableStateOf(false) }
    var managers by remember { mutableStateOf<List<JsonObject>>(emptyList()) }
    var managerId by remember { mutableStateOf<String?>(null) }
    var managerError by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { while (true) { delay(1000); time = System.currentTimeMillis() } }
    LaunchedEffect(override) {
        pin = ""
        if (override && user.storeId != null) {
            try { managers = http.query("helpers/usersHelpers:listManagers", buildJsonObject { put("storeId", user.storeId) }).jsonArray.map { it.jsonObject } }
            catch (_: Exception) { managerError = "Could not load managers. Check your connection." }
        }
    }
    Row(Modifier.fillMaxSize().padding(24.dp), horizontalArrangement = Arrangement.spacedBy(32.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(SimpleDateFormat("h:mm a", Locale.getDefault()).format(Date(time)), style = MaterialTheme.typography.displayLarge)
            Text(locked.snapshot.lockedUserName ?: "User", style = MaterialTheme.typography.headlineMedium)
            Text(locked.snapshot.lockedUserRole ?: "Staff")
            Text("Screen locked", fontWeight = FontWeight.Bold)
            OutlinedButton(onClick = { override = !override; managerId = null }, modifier = Modifier.heightIn(min = 56.dp)) { Text(if (override) "Back to staff PIN" else "Manager override") }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (override) {
                Text("Select manager", style = MaterialTheme.typography.titleLarge)
                managerError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                if (managers.isEmpty()) Text("No managers with PINs available.")
                managers.forEach { manager ->
                    OutlinedButton(onClick = { managerId = manager.string("_id") }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text((if (managerId == manager.string("_id")) "✓ " else "") + (manager.optionalString("name") ?: "Manager")) }
                }
            }
            Text(if (pin.isEmpty()) "Enter PIN" else "●".repeat(pin.length), style = MaterialTheme.typography.headlineMedium)
            if (!override && lock.cooldownSeconds() > 0) Text("Try again in ${lock.cooldownSeconds()} seconds")
            listOf(listOf("1", "2", "3"), listOf("4", "5", "6"), listOf("7", "8", "9"), listOf("Clear", "0", "⌫")).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    row.forEach { digit -> OutlinedButton(onClick = { pin = when (digit) { "Clear" -> ""; "⌫" -> pin.dropLast(1); else -> if (pin.length < 6) pin + digit else pin } }, enabled = !busy && (override || lock.cooldownSeconds() == 0), modifier = Modifier.weight(1f).height(56.dp)) { Text(digit) } }
                }
            }
            Button(onClick = { user.storeId?.let { unlock(it, pin, if (override) managerId else null) }; pin = "" }, enabled = !busy && pin.isNotEmpty() && user.storeId != null && (!override || managerId != null) && (override || lock.cooldownSeconds() == 0), modifier = Modifier.fillMaxWidth().height(56.dp)) { Text(if (busy) "Verifying…" else "Unlock") }
        }
    }
}

/** Replaced by the POS feature navigation in subsequent migration tasks. */
@Composable private fun SessionHome(user: SignedInUser) {
    if (user.storeId == null) Text("No store assigned. Contact your administrator.", color = MaterialTheme.colorScheme.error)
    else Text("Ready for service", style = MaterialTheme.typography.headlineLarge)
}
