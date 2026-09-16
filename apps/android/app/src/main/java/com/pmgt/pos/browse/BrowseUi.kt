package com.pmgt.pos.browse

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.*
import androidx.compose.ui.unit.*
import com.pmgt.pos.R
import com.pmgt.pos.settings.LocalSystemOverallStatus
import com.pmgt.pos.settings.indicatorColor
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal object BrowseColors {
    val Brand = Color(0xFF0D87E1)
    val Background = Color(0xFFF3F4F6)
    val Ink = Color(0xFF111827)
    val Muted = Color(0xFF6B7280)
    val Border = Color(0xFFE5E7EB)
    val Green = Color(0xFF22C55E)
    val Amber = Color(0xFFF59E0B)
    val Red = Color(0xFFEF4444)
}

private val Ionicons = FontFamily(Font(R.font.ionicons))

internal enum class Glyph(val code: Int) {
    Back(0xf127),
    Previous(0xf229),
    Next(0xf23b),
    Close(0xf24a),
    Clear(0xf24b),
    Search(0xf563),
    Receipt(0xf50f),
    Dining(0xf536),
    Bag(0xf15f),
    Cash(0xf206),
    Cube(0xf299),
    Time(0xf5de),
    Forward(0xf137),
    Layers(0xf3af),
    Occupied(0xf535),
    Available(0xf21e),
    People(0xf49f),
    AddCircle(0xf105),
    Trash(0xf5f6),
    Print(0xf4f1),
    Refund(0xf539),
    Void(0xf24c),
    Card(0xf1e8),
    Edit(0xf293),
    Add(0xf103),
    Check(0xf21f),
    Checkmark(0xf21d),
    Document(0xf2b4),
    Done(0xf225),
    Cart(0xf203),
    FilledCart(0xf202),
    Remove(0xf520),
    BagAdd(0xf159),
    Checkbox(0xf21a),
    Square(0xf593),
    PriceTag(0xf4eb),
    CheckFilled(0xf21e),
}

@Composable
internal fun Ion(glyph: Glyph, size: Int = 20, color: Color = BrowseColors.Muted) {
    Text(
        glyph.code.toChar().toString(),
        fontFamily = Ionicons,
        fontSize = size.sp,
        color = color,
        modifier = Modifier.clearAndSetSemantics {},
    )
}

@Composable
internal fun Label(
    text: String,
    size: Int = 14,
    color: Color = BrowseColors.Ink,
    weight: FontWeight = FontWeight.Normal,
    modifier: Modifier = Modifier,
) {
    Text(
        text,
        modifier,
        color = color,
        fontSize = size.sp,
        fontWeight = weight,
        letterSpacing = 0.sp,
    )
}

@Composable
internal fun ActionButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    color: Color = BrowseColors.Brand,
    outline: Boolean = false,
    enabled: Boolean = true,
    glyph: Glyph? = null,
) {
    Surface(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.heightIn(min = 48.dp),
        shape = RoundedCornerShape(10.dp),
        color = if (!enabled) Color(0xFF9CA3AF) else if (outline) Color.White else color,
        border = if (outline) BorderStroke(1.dp, color) else null,
    ) {
        Row(
            Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            val ink = if (outline && enabled) color else Color.White
            glyph?.let {
                Ion(it, 20, ink)
                Spacer(Modifier.width(8.dp))
            }
            Label(label, 16, ink, FontWeight.SemiBold)
        }
    }
}

@Composable
internal fun IconAction(label: String, glyph: Glyph, onClick: () -> Unit, enabled: Boolean = true) {
    IconButton(
        onClick,
        enabled = enabled,
        modifier = Modifier.size(48.dp).semantics { contentDescription = label },
    ) {
        Ion(glyph, 24, if (enabled) BrowseColors.Muted else Color(0xFFD1D5DB))
    }
}

@Composable
internal fun StatusBadge(
    text: String,
    color: Color = BrowseColors.Muted,
    background: Color = Color(0xFFF3F4F6),
) {
    Box(
        Modifier.background(background, RoundedCornerShape(999.dp))
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        Label(text, 12, color, FontWeight.SemiBold)
    }
}

@Composable
internal fun PaymentBadge(status: String) {
    when (status) {
        "paid" -> StatusBadge("Paid", Color(0xFF16A34A), Color(0xFFDCFCE7))
        "voided" -> StatusBadge("Voided", BrowseColors.Red, Color(0xFFFEE2E2))
        else -> StatusBadge(status.replaceFirstChar { it.uppercase() })
    }
}

@Composable
internal fun PageHeader(
    title: String,
    subtitle: String? = null,
    onBack: () -> Unit,
    onStatus: () -> Unit,
    right: @Composable RowScope.() -> Unit = {},
    badges: @Composable RowScope.() -> Unit = {},
    titleSize: Int = 18,
    titleWeight: FontWeight = FontWeight.Bold,
) {
    Column(Modifier.background(Color.White)) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            IconAction("Back", Glyph.Back, onBack)
            Column(Modifier.weight(1f)) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Label(title, titleSize, weight = titleWeight)
                    badges()
                }
                subtitle?.let { Label(it, 14, BrowseColors.Muted) }
            }
            right()
            SystemIndicator(onStatus)
        }
        HorizontalDivider(color = BrowseColors.Border)
    }
}

@Composable
internal fun SystemIndicator(onStatus: () -> Unit) {
    val overall = LocalSystemOverallStatus.current
    Box(
        Modifier.size(30.dp).clickable(onClick = onStatus).semantics {
            contentDescription = "System status"
        },
        contentAlignment = Alignment.Center,
    ) {
        Box(Modifier.size(14.dp).background(overall.indicatorColor, RoundedCornerShape(7.dp)))
    }
}

@Composable
internal fun Loading(modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        CircularProgressIndicator(color = BrowseColors.Brand)
    }
}

@Composable
internal fun EmptyOrders(
    title: String,
    description: String,
    glyph: Glyph = Glyph.Receipt,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Ion(glyph, 48, Color(0xFFD1D5DB))
        Spacer(Modifier.height(12.dp))
        Label(title, 16, BrowseColors.Muted)
        Spacer(Modifier.height(4.dp))
        Label(description, 14, BrowseColors.Muted)
    }
}

@Composable
internal fun FilterChipText(text: String, selected: Boolean, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        color = if (selected) BrowseColors.Brand else BrowseColors.Background,
        shape = RoundedCornerShape(999.dp),
        modifier = Modifier.semantics { this.selected = selected },
    ) {
        Label(
            text,
            14,
            if (selected) Color.White else Color(0xFF374151),
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        )
    }
}

internal fun quantity(value: Double) =
    if (value % 1 == 0.0) value.toLong().toString() else value.toString()

internal fun dateText(
    time: Long,
    pattern: String,
    locale: Locale = Locale.forLanguageTag("en-PH"),
): String =
    DateTimeFormatter.ofPattern(pattern, locale)
        .format(Instant.ofEpochMilli(time).atZone(ZoneId.systemDefault()))

internal fun orderType(type: String) = if (type == "dine_in") "Dine-In" else "Take-out"

internal fun ago(created: Long, now: Long = System.currentTimeMillis()): String {
    val minutes = (now - created) / 60_000
    return when {
        minutes < 1 -> "Just now"
        minutes < 60 -> "${minutes}m ago"
        minutes < 1440 -> "${minutes / 60}h ${minutes % 60}m"
        else -> "${minutes / 1440}d ago"
    }
}
