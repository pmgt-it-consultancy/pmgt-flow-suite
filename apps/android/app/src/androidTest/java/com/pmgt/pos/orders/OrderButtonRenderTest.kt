package com.pmgt.pos.orders

import androidx.compose.foundation.layout.Column
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.pmgt.pos.browse.BrowseColors
import com.pmgt.pos.catalog.*
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class OrderButtonRenderTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun sourcePrimaryAndSendActionsHaveVisibleBackgrounds() {
        compose.setContent {
            Column {
                EntryButton("Primary", {}, color = BrowseColors.Brand)
                EntryButton("Send", {}, color = BrowseColors.Green)
                EntryButton("Takeout", {}, color = Orange)
            }
        }
        listOf(
                "Primary" to Color(0xFF0D87E1),
                "Send" to Color(0xFF22C55E),
                "Takeout" to Color(0xFFF97316),
            )
            .forEach { (label, color) ->
                val pixels = compose.onNodeWithText(label).captureToImage().toPixelMap()
                assertEquals(label, color.toArgb(), pixels[pixels.width / 2, 4].toArgb())
            }
    }

    @Test
    fun draftCartSendHasSourceGreenBackground() {
        val state =
            EditorState(
                null,
                "Table 1",
                drafts =
                    listOf(
                        DraftLine(
                            "d",
                            ProductChoice(
                                SelectedProduct("p", "Meal", 112.0),
                                1,
                                "",
                                emptyList(),
                                null,
                            ),
                            1.0,
                        )
                    ),
            )
        compose.setContent {
            EntryCart(state, false, emptyMap(), { _, _ -> }, {}, { _, _ -> }, {}, {}, {}, {}, {})
        }
        val pixels = compose.onNodeWithText("Send to Kitchen").captureToImage().toPixelMap()
        assertEquals(Color(0xFF22C55E).toArgb(), pixels[pixels.width / 2, 4].toArgb())
    }
}
