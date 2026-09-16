package com.pmgt.pos.checkout

import android.view.WindowManager
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.*
import androidx.compose.ui.window.*
import com.pmgt.pos.R
import com.pmgt.pos.browse.*
import com.pmgt.pos.catalog.catalogPress

@Composable
internal fun CheckoutCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(
        modifier
            .fillMaxWidth()
            .background(Color.White, RoundedCornerShape(12.dp))
            .border(1.dp, BrowseColors.Border, RoundedCornerShape(12.dp))
            .padding(16.dp),
        content = content,
    )
}

@Composable
internal fun CheckoutButton(
    text: String,
    click: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    color: Color = BrowseColors.Brand,
    ink: Color = Color.White,
    fontSize: Int = 18,
    vertical: Int = 16,
    radius: Int = 12,
    border: Color? = null,
    glyph: Glyph? = null,
    busy: Boolean = false,
    disabledAlpha: Float = .5f,
) {
    Row(
        modifier
            .graphicsLayer { alpha = if (enabled) 1f else disabledAlpha }
            .clip(RoundedCornerShape(radius.dp))
            .background(color)
            .then(
                if (border != null) Modifier.border(1.5.dp, border, RoundedCornerShape(radius.dp))
                else Modifier
            )
            .catalogPress(enabled, click)
            .semantics { role = Role.Button }
            .padding(horizontal = 16.dp, vertical = vertical.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (busy) CircularProgressIndicator(Modifier.size(24.dp), color = ink, strokeWidth = 2.dp)
        else {
            glyph?.let {
                Ion(it, 24, ink)
                Spacer(Modifier.width(8.dp))
            }
            Label(text, fontSize, ink, FontWeight.SemiBold)
        }
    }
}

@Composable
internal fun CheckoutField(
    value: String,
    change: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    size: Int = 16,
    weight: FontWeight = FontWeight.Normal,
    color: Color = BrowseColors.Ink,
    background: Color = Color(0xFFF9FAFB),
    border: Color = Color(0xFFD1D5DB),
    radius: Int = 10,
    padding: Int = 14,
    keyboard: KeyboardOptions = KeyboardOptions.Default,
    actions: KeyboardActions = KeyboardActions.Default,
    transformation: VisualTransformation = VisualTransformation.None,
    center: Boolean = false,
    letterSpacing: Int = 0,
) {
    BasicTextField(
        value,
        change,
        modifier
            .fillMaxWidth()
            .background(background, RoundedCornerShape(radius.dp))
            .border(1.dp, border, RoundedCornerShape(radius.dp))
            .padding(padding.dp),
        enabled = enabled,
        textStyle =
            TextStyle(
                fontSize = size.sp,
                color = color,
                fontWeight = weight,
                letterSpacing = letterSpacing.sp,
                textAlign = if (center) TextAlign.Center else TextAlign.Start,
            ),
        keyboardOptions = keyboard,
        keyboardActions = actions,
        visualTransformation = transformation,
        singleLine = true,
        decorationBox = { inner ->
            Box {
                if (value.isEmpty())
                    Label(
                        placeholder,
                        size,
                        Color(0xFF9CA3AF),
                        modifier = if (center) Modifier.align(Alignment.Center) else Modifier,
                    )
                inner()
            }
        },
    )
}

@Composable
internal fun CheckoutModal(
    title: String,
    close: () -> Unit,
    center: Boolean = false,
    content: @Composable ColumnScope.() -> Unit,
) {
    Dialog(
        close,
        properties =
            DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false),
    ) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window
        SideEffect {
            window?.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            window?.setWindowAnimations(R.style.CatalogDialogAnimation)
        }
        BoxWithConstraints(
            Modifier.fillMaxSize().imePadding(),
            contentAlignment = if (center) Alignment.Center else Alignment.BottomCenter,
        ) {
            Box(
                Modifier.fillMaxSize()
                    .background(Color.Black.copy(alpha = .5f))
                    .clickable(onClick = close)
                    .semantics { contentDescription = "Close checkout backdrop" }
            )
            Column(
                Modifier.then(
                        if (center)
                            Modifier.padding(horizontal = 16.dp)
                                .widthIn(max = 448.dp)
                                .fillMaxWidth()
                                .heightIn(max = maxHeight)
                        else Modifier.fillMaxWidth().heightIn(max = maxHeight * .8f)
                    )
                    .clip(
                        if (center) RoundedCornerShape(16.dp)
                        else RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp)
                    )
                    .background(Color.White)
                    .verticalScroll(rememberScrollState())
                    .padding(20.dp)
            ) {
                Row(
                    Modifier.fillMaxWidth().padding(bottom = 16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Label(title, 18, weight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                    Box(
                        Modifier.size(40.dp).catalogPress(true, close).semantics {
                            contentDescription = "Close dialog"
                        },
                        contentAlignment = Alignment.Center,
                    ) {
                        Ion(Glyph.Close, 24)
                    }
                }
                content()
            }
        }
    }
}

internal fun Modifier.checkoutDashed() = drawBehind {
    drawRoundRect(
        BrowseColors.Brand,
        cornerRadius = androidx.compose.ui.geometry.CornerRadius(12.dp.toPx()),
        style =
            Stroke(
                1.5.dp.toPx(),
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(8.dp.toPx(), 5.dp.toPx())),
            ),
    )
}
