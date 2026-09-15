package com.pmgt.pos.auth

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.*
import androidx.compose.foundation.text.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.*
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.input.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.BuildConfig
import com.pmgt.pos.R
import com.pmgt.pos.db.AdoptionState
import com.pmgt.pos.sync.AdoptionGate
import com.pmgt.pos.sync.TabletStartup
import com.pmgt.pos.transport.ConvexHttp
import java.text.SimpleDateFormat
import java.util.*
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

private val Brand = Color(0xFF0D87E1)
private val Ink = Color(0xFF111827)
private val Muted = Color(0xFF6B7280)
private val Border = Color(0xFFD1D5DB)
private val Page = Color(0xFFF9FAFB)
private val Danger = Color(0xFFDC2626)
private val Icons = FontFamily(Font(R.font.ionicons))

private enum class UnlockOperation {
    STAFF,
    MANAGER,
}

private data class UiAlert(
    val id: Long = 0,
    val title: String,
    val message: String,
    val operation: UnlockOperation? = null,
)

@Composable
fun PosAuthShell(
    auth: AuthRepository,
    lock: LockState,
    http: ConvexHttp,
    configured: Boolean = BuildConfig.CONVEX_URL.isNotBlank(),
    showTestControls: Boolean = false,
    startup: TabletStartup? = null,
    content: @Composable (SignedInUser) -> Unit = { SessionHome(it) },
) {
    val session by auth.state.collectAsStateWithLifecycle()
    val locked by lock.state.collectAsStateWithLifecycle()
    val tablet = startup?.state?.collectAsStateWithLifecycle()?.value
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var lockError by remember { mutableStateOf<UiAlert?>(null) }
    var eventId by remember { mutableLongStateOf(0) }
    fun perform(block: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } finally {
                busy = false
            }
        }
    }
    LaunchedEffect(auth, configured) { if (configured) auth.restore() }
    LaunchedEffect(session.user?.id) {
        val user = session.user ?: return@LaunchedEffect
        try {
            lock.configure(user)
        } catch (e: CancellationException) {
            throw e
        }
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
            try {
                auth.reloadUser()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {}
        }
    }
    MaterialTheme(colorScheme = lightColorScheme(primary = Brand)) {
        Box(Modifier.fillMaxSize().background(Brand)) {
            Surface(
                Modifier.fillMaxSize()
                    .windowInsetsPadding(WindowInsets.statusBars.only(WindowInsetsSides.Top)),
                color = Color.White,
            ) {
                when {
                    session.user == null ->
                        LoginScreen(busy || session.loading, configured) { e, p, failed ->
                            perform {
                                try {
                                    auth.signIn(e, p)
                                } catch (error: CancellationException) {
                                    throw error
                                } catch (_: Exception) {
                                    failed(
                                        auth.state.value.error
                                            ?: "An unexpected error occurred. Please try again."
                                    )
                                }
                            }
                        }
                    locked.snapshot.isLocked ->
                        LockScreen(
                            lock,
                            session.user!!,
                            http,
                            busy,
                            lockError,
                            { lockError = null },
                        ) { s, p, m ->
                            perform {
                                try {
                                    lock.unlock(s, p, m)?.let {
                                        lockError =
                                            UiAlert(
                                                ++eventId,
                                                if (m == null) "Invalid PIN"
                                                else "Manager Override Failed",
                                                it,
                                                if (m == null) UnlockOperation.STAFF
                                                else UnlockOperation.MANAGER,
                                            )
                                    }
                                } catch (error: CancellationException) {
                                    throw error
                                } catch (_: Exception) {
                                    lockError =
                                        UiAlert(
                                            ++eventId,
                                            "Error",
                                            if (m == null) "Failed to verify PIN. Please try again."
                                            else "Failed to verify manager PIN.",
                                            if (m == null) UnlockOperation.STAFF
                                            else UnlockOperation.MANAGER,
                                        )
                                }
                            }
                        }
                    startup != null && session.selectedStoreId != null &&
                        (tablet?.userId != session.user!!.id || tablet.storeId != session.selectedStoreId || tablet.adoption !is AdoptionState.Ready) ->
                        AdoptionGate(tablet?.adoption ?: AdoptionState.PendingVerification(), busy || tablet?.verifying == true) {
                            perform { startup.adopt(session.user!!.id, session.selectedStoreId!!) }
                        }
                    else ->
                        Box(Modifier.fillMaxSize()) {
                            content(session.user!!)
                            if (locked.showIdleWarning)
                                IdleWarning(
                                    lock.lockDeadline() ?: System.currentTimeMillis(),
                                    lock::resetActivity,
                                )
                            if (showTestControls)
                                Row(Modifier.align(Alignment.TopEnd).padding(8.dp)) {
                                    TextButton({ perform { lock.lock(session.user!!) } }) {
                                        Text("Lock screen")
                                    }
                                    TextButton({ perform { startup?.stop(); auth.signOut() } }) { Text("Sign out") }
                                }
                        }
                }
            }
        }
    }
}

@Composable
private fun LoginScreen(
    busy: Boolean,
    configured: Boolean,
    signIn: (String, String, (String) -> Unit) -> Unit,
) {
    var email by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var alert by remember { mutableStateOf<UiAlert?>(null) }
    var attempt by remember { mutableLongStateOf(0) }
    fun submit() {
        when {
            email.isBlank() -> alert = UiAlert(++attempt, "Error", "Please enter your email")
            password.isEmpty() -> alert = UiAlert(++attempt, "Error", "Please enter your password")
            else ->
                signIn(email.trim(), password) { message ->
                    alert = UiAlert(++attempt, "Login Failed", message)
                }
        }
    }
    Box(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 20.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(20.dp))
            Image(
                painterResource(R.drawable.logo_full),
                "PMGT Flow Suite",
                Modifier.fillMaxWidth().height(224.dp),
                contentScale = ContentScale.Fit,
            )
            Text(
                "Enter your credentials to continue",
                color = Ink,
                fontSize = 16.sp,
                letterSpacing = 0.sp,
                textAlign = TextAlign.Center,
                modifier = Modifier.padding(top = 24.dp, bottom = 32.dp),
            )
            AuthInput(email, { email = it }, "Email", busy, KeyboardType.Email, ImeAction.Next)
            Spacer(Modifier.height(16.dp))
            AuthInput(
                password,
                { password = it },
                "Password",
                busy,
                KeyboardType.Password,
                ImeAction.Done,
                true,
                ::submit,
            )
            Spacer(Modifier.height(24.dp))
            PrimaryButton("Login", busy, Modifier.fillMaxWidth(), click = ::submit)
            if (!configured)
                Text(
                    "Set CONVEX_URL in local.properties and rebuild to connect this app.",
                    color = Danger,
                    modifier = Modifier.padding(top = 12.dp),
                )
            Text(
                "PMGT Flow Suite POS v1.0",
                color = Ink,
                fontSize = 12.sp,
                letterSpacing = 0.sp,
                modifier = Modifier.padding(top = 40.dp),
            )
        }
    }
    alert?.let { a ->
        AlertDialog(
            { alert = null },
            title = { Text(a.title) },
            text = { Text(a.message) },
            confirmButton = { TextButton({ alert = null }) { Text("OK") } },
        )
    }
}

@Composable
private fun AuthInput(
    value: String,
    change: (String) -> Unit,
    hint: String,
    busy: Boolean,
    type: KeyboardType,
    ime: ImeAction,
    password: Boolean = false,
    submit: () -> Unit = {},
) {
    val shape = RoundedCornerShape(5.dp)
    BasicTextField(
        value = value,
        onValueChange = change,
        enabled = !busy,
        singleLine = true,
        textStyle = TextStyle(color = Ink, fontSize = 16.sp, letterSpacing = 0.sp),
        visualTransformation =
            if (password) PasswordVisualTransformation() else VisualTransformation.None,
        keyboardOptions = KeyboardOptions(keyboardType = type, imeAction = ime),
        keyboardActions = KeyboardActions(onDone = { submit() }),
        cursorBrush = SolidColor(Brand),
        modifier =
            Modifier.fillMaxWidth()
                .height(70.dp)
                .alpha(if (busy) .5f else 1f)
                .background(Color.White, shape)
                .border(1.dp, Ink, shape)
                // 22dp reproduces Tamagui's $4 token plus the native TextInput inset on this
                // target.
                .padding(horizontal = 22.dp, vertical = 13.dp),
        decorationBox = { innerField ->
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.CenterStart) {
                if (value.isEmpty())
                    Text(hint, color = Color(0xFF9CA3AF), fontSize = 16.sp, letterSpacing = 0.sp)
                innerField()
            }
        },
    )
}

@Composable
private fun PrimaryButton(
    label: String,
    loading: Boolean,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    showSpinner: Boolean = true,
    click: () -> Unit,
) =
    Button(
        click,
        modifier.heightIn(min = 56.dp).alpha(if (enabled && !loading) 1f else .5f),
        enabled && !loading,
        shape = RoundedCornerShape(12.dp),
        colors =
            ButtonDefaults.buttonColors(
                containerColor = Brand,
                disabledContainerColor = Brand,
                disabledContentColor = Color.White,
            ),
    ) {
        if (loading && showSpinner)
            CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
        else Text(label, fontSize = 18.sp, fontWeight = FontWeight.Normal, letterSpacing = 0.sp)
    }

@Composable
private fun LockScreen(
    lock: LockState,
    user: SignedInUser,
    http: ConvexHttp,
    busy: Boolean,
    error: UiAlert?,
    consumeError: () -> Unit,
    unlock: (String, String, String?) -> Unit,
) {
    val locked by lock.state.collectAsStateWithLifecycle()
    var pin by rememberSaveable { mutableStateOf("") }
    var time by remember { mutableLongStateOf(System.currentTimeMillis()) }
    var manager by rememberSaveable { mutableStateOf(false) }
    var alert by remember { mutableStateOf<UiAlert?>(null) }
    val shake = remember { Animatable(0f) }
    val h = LocalConfiguration.current.screenHeightDp
    val scale = if (h < 820) .76f else if (h < 900) .88f else 1f
    LaunchedEffect(Unit) {
        while (true) {
            delay(1000)
            time = System.currentTimeMillis()
        }
    }
    LaunchedEffect(error?.id) {
        if (error?.operation == UnlockOperation.STAFF) {
            alert = error
            pin = ""
            for (target in listOf(12f, -12f, 8f, 0f)) shake.animateTo(target, tween(50))
            consumeError()
        }
    }
    val format = SimpleDateFormat("h:mm a", Locale.getDefault())
    val since = locked.snapshot.lockedAt?.let { format.format(Date(it)) }.orEmpty()
    Column(
        Modifier.fillMaxSize().background(Page).padding(horizontal = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            format.format(Date(time)),
            fontSize = (64 * scale).sp,
            lineHeight = (76 * scale).sp,
            fontWeight = FontWeight.Bold,
            color = Ink,
        )
        Text(
            SimpleDateFormat("EEEE, MMMM d, yyyy", Locale.getDefault()).format(Date(time)),
            fontSize = maxOf(15f, 18 * scale).sp,
            color = Muted,
            modifier = Modifier.padding(top = maxOf(4f, 6 * scale).dp),
        )
        Box(
            Modifier.padding(top = (38 * scale).dp, bottom = (24 * scale).dp)
                .size((104 * scale).dp)
                .background(Color(0xFFDBEAFE), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(62407, (42 * scale).sp, Brand, "Locked")
        }
        Text(
            locked.snapshot.lockedUserName ?: "User",
            fontSize = maxOf(22f, 28 * scale).sp,
            fontWeight = FontWeight.Bold,
            color = Ink,
        )
        Text(
            (locked.snapshot.lockedUserRole ?: "Staff") +
                if (since.isNotEmpty()) " • Locked since $since" else "",
            fontSize = maxOf(15f, 18 * scale).sp,
            color = Muted,
            modifier = Modifier.padding(top = maxOf(4f, 6 * scale).dp),
        )
        PinPad(
            pin,
            { pin = it },
            busy || lock.cooldownSeconds() > 0,
            scale,
            Modifier.padding(top = (34 * scale).dp).graphicsLayer { translationX = shake.value },
        )
        if (lock.cooldownSeconds() > 0)
            Text(
                "Try again in ${lock.cooldownSeconds()}s",
                color = Danger,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.padding(top = (16 * scale).dp),
            )
        PrimaryButton(
            if (busy) "Verifying..." else "Unlock",
            busy,
            Modifier.padding(top = (30 * scale).dp)
                .widthIn(min = (320 * scale).dp)
                .heightIn(min = (64 * scale).dp),
            pin.isNotEmpty() && lock.cooldownSeconds() == 0,
            false,
        ) {
            user.storeId?.let { unlock(it, pin, null) }
        }
        Text(
            "Manager Override",
            color = Brand,
            fontSize = maxOf(15f, 18 * scale).sp,
            fontWeight = FontWeight.SemiBold,
            modifier =
                Modifier.padding(top = (22 * scale).dp).clickable { manager = true }.padding(8.dp),
        )
    }
    if (manager)
        ManagerDialog(user, http, busy, error, consumeError, { manager = false }) { id, p ->
            user.storeId?.let { unlock(it, p, id) }
        }
    alert?.let { a ->
        AlertDialog(
            { alert = null },
            title = { Text(a.title) },
            text = { Text(a.message) },
            confirmButton = { TextButton({ alert = null }) { Text("OK") } },
        )
    }
}

@Composable
private fun PinPad(
    pin: String,
    change: (String) -> Unit,
    disabled: Boolean,
    scale: Float,
    modifier: Modifier = Modifier,
) {
    val w = (88 * scale).dp
    val h = (76 * scale).dp
    val gap = maxOf(10f, 14 * scale).dp
    Column(
        modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(gap),
    ) {
        Row(
            Modifier.padding(bottom = maxOf(18f, 28 * scale).dp),
            horizontalArrangement = Arrangement.spacedBy(maxOf(10f, 16 * scale).dp),
        ) {
            repeat(6) { i ->
                Box(
                    Modifier.size(maxOf(14f, 20 * scale).dp)
                        .semantics {
                            contentDescription =
                                "PIN digit ${i+1} of 6, ${if(i<pin.length)"filled" else "empty"}"
                        }
                        .then(
                            if (i < pin.length) Modifier.background(Brand, CircleShape)
                            else Modifier.border(2.dp, Border, CircleShape)
                        )
                )
            }
        }
        listOf(
                listOf("1", "2", "3"),
                listOf("4", "5", "6"),
                listOf("7", "8", "9"),
                listOf("", "0", "⌫"),
            )
            .forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(gap)) {
                    row.forEach { k ->
                        when (k) {
                            "" -> Spacer(Modifier.size(w, h))
                            "⌫" ->
                                Box(
                                    Modifier.size(w, h)
                                        .alpha(if (disabled) .5f else 1f)
                                        .background(
                                            Color(0xFFFEE2E2),
                                            RoundedCornerShape((18 * scale).dp),
                                        )
                                        .clickable(enabled = !disabled && pin.isNotEmpty()) {
                                            change(pin.dropLast(1))
                                        },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Icon(
                                        61781,
                                        maxOf(24f, 28 * scale).sp,
                                        Color(0xFFEF4444),
                                        "Backspace",
                                    )
                                }
                            else ->
                                Box(
                                    Modifier.size(w, h)
                                        .alpha(if (disabled) .5f else 1f)
                                        .background(
                                            Color.White,
                                            RoundedCornerShape((18 * scale).dp),
                                        )
                                        .border(
                                            1.dp,
                                            Color(0xFFE5E7EB),
                                            RoundedCornerShape((18 * scale).dp),
                                        )
                                        .clickable(enabled = !disabled && pin.length < 6) {
                                            change(pin + k)
                                        },
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        k,
                                        fontSize = maxOf(24f, 30 * scale).sp,
                                        fontWeight = FontWeight.Medium,
                                        color = Ink,
                                    )
                                }
                        }
                    }
                }
            }
    }
}

@Composable
private fun ManagerDialog(
    user: SignedInUser,
    http: ConvexHttp,
    busy: Boolean,
    error: UiAlert?,
    consumeError: () -> Unit,
    close: () -> Unit,
    submit: (String, String) -> Unit,
) {
    var managers by remember { mutableStateOf<List<JsonObject>?>(null) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var pin by rememberSaveable { mutableStateOf("") }
    var failed by remember { mutableStateOf(false) }
    var alert by remember { mutableStateOf<UiAlert?>(null) }
    LaunchedEffect(user.storeId) {
        try {
            managers =
                user.storeId?.let {
                    http
                        .query(
                            "helpers/usersHelpers:listManagers",
                            buildJsonObject { put("storeId", it) },
                        )
                        .jsonArray
                        .map { it.jsonObject }
                } ?: emptyList()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            failed = true
            managers = emptyList()
        }
    }
    LaunchedEffect(error?.id) {
        if (error?.operation == UnlockOperation.MANAGER) {
            pin = ""
            alert = error
            consumeError()
        }
    }
    Dialog(
        onDismissRequest = close,
        properties =
            DialogProperties(
                dismissOnBackPress = true,
                dismissOnClickOutside = true,
                usePlatformDefaultWidth = false,
                decorFitsSystemWindows = false,
            ),
    ) {
        val outerScroll = rememberScrollState()
        Box(
            Modifier.fillMaxSize()
                .background(Color.Black.copy(alpha = .5f))
                .clickable { close() }
                .windowInsetsPadding(WindowInsets.ime)
                .verticalScroll(outerScroll)
                .padding(horizontal = 16.dp),
            contentAlignment = Alignment.Center,
        ) {
            Column(
                Modifier.widthIn(max = 448.dp)
                    .fillMaxWidth()
                    .background(Color.White, RoundedCornerShape(16.dp))
                    .clickable {}
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Manager Override", fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
                    Icon(62026, 24.sp, Muted, "Close", Modifier.clickable { close() }.padding(8.dp))
                }
                Text(
                    "A manager can unlock this screen with their PIN.",
                    color = Muted,
                    fontSize = 14.sp,
                )
                Text("Select Manager", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Column(
                    Modifier.heightIn(max = 220.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    when {
                        managers == null ->
                            Box(
                                Modifier.fillMaxWidth().height(48.dp),
                                contentAlignment = Alignment.Center,
                            ) {
                                CircularProgressIndicator(Modifier.size(22.dp))
                            }
                        failed ->
                            Text("Could not load managers. Check your connection.", color = Danger)
                        managers!!.isEmpty() ->
                            Text(
                                "No managers with PINs available. Contact your administrator.",
                                color = Muted,
                                textAlign = TextAlign.Center,
                            )
                        else ->
                            managers!!.forEach { m ->
                                val id = m.string("_id")
                                Row(
                                    Modifier.fillMaxWidth()
                                        .background(
                                            if (selected == id) Color(0xFFDBEAFE) else Page,
                                            RoundedCornerShape(10.dp),
                                        )
                                        .border(
                                            1.dp,
                                            if (selected == id) Brand else Color(0xFFE5E7EB),
                                            RoundedCornerShape(10.dp),
                                        )
                                        .clickable { selected = id }
                                        .padding(16.dp, 12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                ) {
                                    Column {
                                        Text(
                                            m.optionalString("name") ?: "Manager",
                                            fontWeight = FontWeight.SemiBold,
                                        )
                                        Text(
                                            m.optionalString("roleName") ?: "Manager",
                                            color = Muted,
                                            fontSize = 13.sp,
                                        )
                                    }
                                    if (selected == id) Icon(61982, 20.sp, Brand, "Selected")
                                }
                            }
                    }
                }
                if (selected != null) {
                    Text("Enter PIN", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                    AuthInput(
                        pin,
                        { pin = it.filter(Char::isDigit).take(6) },
                        "Enter manager PIN",
                        busy,
                        KeyboardType.NumberPassword,
                        ImeAction.Done,
                        true,
                    )
                }
                PrimaryButton(
                    if (busy) "Verifying..." else "Unlock",
                    busy,
                    Modifier.fillMaxWidth().testTag("manager-unlock"),
                    selected != null && pin.isNotEmpty(),
                ) {
                    submit(requireNotNull(selected), pin)
                }
            }
        }
    }
    alert?.let { a ->
        AlertDialog(
            { alert = null },
            title = { Text(a.title) },
            text = { Text(a.message) },
            confirmButton = { TextButton({ alert = null }) { Text("OK") } },
        )
    }
}

@Composable
private fun IdleWarning(lockTime: Long, dismiss: () -> Unit) {
    var seconds by remember(lockTime) { mutableIntStateOf(30) }
    LaunchedEffect(lockTime) {
        while (true) {
            seconds =
                ((lockTime - System.currentTimeMillis()).coerceAtLeast(0) + 999).div(1000).toInt()
            delay(1_000)
        }
    }
    Box(
        Modifier.fillMaxSize().background(Color.Black.copy(alpha = .3f)).clickable { dismiss() },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.fillMaxWidth(.85f)
                .background(Color(0xFFFEF3C7), RoundedCornerShape(16.dp))
                .border(2.dp, Color(0xFFF59E0B), RoundedCornerShape(16.dp))
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(
                61508,
                24.sp,
                Color(0xFFD97706),
                "Idle warning",
                Modifier.size(48.dp).background(Color(0xFFFDE68A), CircleShape).padding(12.dp),
            )
            Text(
                "Screen will lock in ${seconds}s",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = Color(0xFF92400E),
                modifier = Modifier.padding(top = 12.dp),
            )
            Text(
                "Tap anywhere to stay active",
                fontSize = 13.sp,
                color = Color(0xFFA16207),
                modifier = Modifier.padding(top = 4.dp, bottom = 16.dp),
            )
            Text(
                "Stay Active",
                color = Color.White,
                fontWeight = FontWeight.SemiBold,
                modifier =
                    Modifier.background(Color(0xFFF59E0B), RoundedCornerShape(10.dp))
                        .padding(horizontal = 32.dp, vertical = 12.dp),
            )
        }
    }
}

@Composable
private fun Icon(
    code: Int,
    size: TextUnit,
    color: Color,
    description: String,
    modifier: Modifier = Modifier,
) =
    Text(
        code.toChar().toString(),
        fontFamily = Icons,
        fontSize = size,
        color = color,
        modifier = modifier.semantics { contentDescription = description },
    )

@Composable
private fun SessionHome(user: SignedInUser) {
    if (user.storeId == null) Text("No store assigned. Contact your administrator.", color = Danger)
    else Text("Ready for service", fontSize = 30.sp)
}
