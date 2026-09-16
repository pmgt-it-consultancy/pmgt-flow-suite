package com.pmgt.pos

import androidx.compose.ui.window.DialogProperties

/**
 * POS dialogs require an intentional dismissal. A stray tap outside the dialog must never close it.
 */
fun posDialogProperties(
    dismissOnBackPress: Boolean = true,
    usePlatformDefaultWidth: Boolean = true,
    decorFitsSystemWindows: Boolean = true,
) =
    DialogProperties(
        dismissOnBackPress = dismissOnBackPress,
        dismissOnClickOutside = false,
        usePlatformDefaultWidth = usePlatformDefaultWidth,
        decorFitsSystemWindows = decorFitsSystemWindows,
    )
