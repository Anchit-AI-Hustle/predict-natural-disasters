package com.anchittandon.pnd.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** design.md §1. The website has no light theme, so neither does the app. */
object Pnd {
    val bg = Color(0xFF02110D)
    val glow = Color(0xFF0B3C2D)
    val panel = Color(0xFF06261D)
    val panelTop = Color(0xFF07251B)
    val panelBottom = Color(0xFF051B14)
    val panel2 = Color(0xFF082E23)
    val card = Color(0xFF09231B)
    val cardAlt = Color(0xFF08251C)
    val input = Color(0xFF09251D)
    val line = Color(0xFF156047)
    val line2 = Color(0xFF0D4535)
    val panelBorder = Color(0xFF1D654C)
    val cardBorder = Color(0xFF285C49)
    val inputBorder = Color(0xFF285F4B)
    val divider = Color(0xFF1B5745)
    val text = Color(0xFFF5FBF8)
    val textSoft = Color(0xFFCFE3DA)
    val body = Color(0xFFDCECE4)
    val muted = Color(0xFF91B4A6)
    val label = Color(0xFF8EAA9E)
    val green = Color(0xFF25E29C)
    val greenText = Color(0xFF8FF0CA)
    val greenLive = Color(0xFF65E7B6)
    val link = Color(0xFF6FE3FF)
    val amber = Color(0xFFFFBF2F)
    val authority = Color(0xFFFFD9A8)
    val blue = Color(0xFF3A9DF7)
    val onGreen = Color(0xFF04120E)
    val provBorder = Color(0xFF2B624E)
    val provText = Color(0xFFCFE3DA)
    val sourceText = Color(0xFF9FD0BB)
    val noticeBorder = Color(0xFF735C1C)
    val noticeFill = Color(0xFF211C0B)
    val noticeText = Color(0xFFD7CDA5)
    val staleBorder = Color(0xFFA96E28)
    val staleFill = Color(0xFF2A1B09)
    val trustFill = Color(0xFF071F18)
    val trustText = Color(0xFFD9EBE3)
    val trustWhen = Color(0xFF9FBCB0)
    val actionAccent = Color(0xFFFFB15E)
    val empty = Color(0xFF8EAA9F)
    val tabBar = Color(0xFF02110D)
    val tabBorder = Color(0xFF174638)
    val tabInactive = Color(0xFFE6F4EE)
    val okBorder = Color(0xFF25E29C); val okText = Color(0xFF8FF0CB)
    val warnBorder = Color(0xFFE9B949); val warnText = Color(0xFFF2D894)
    val badBorder = Color(0xFFEF5261); val badText = Color(0xFFFFA7B0)
    val mutedBorder = Color(0xFF9AA7A2); val mutedText = Color(0xFFC2CFCA)
    val missedBorder = Color(0xFFC168FF); val missedText = Color(0xFFDCB6FF)
    val serious = Color(0xFFEF2639)
    val levelChip = Color(0xFF2D7A5D); val levelChipText = Color(0xFF9FE9C8)
    val ocean = Color(0xFF0E2631)
    val land = Color(0xFF22342D)
    val border = Color(0xFF5F7D70)
    val mapLabel = Color(0xFFC7D6CF)
    val unknownMarker = Color(0xFF8FA8A0)
    val kpi = Color(0xFF072B20); val kpiBorder = Color(0xFF176148)
    val metric = Color(0xFF071C16); val metricBorder = Color(0xFF183F33)
    val footer = Color(0xFF03140F)
}

private val scheme = darkColorScheme(
    primary = Pnd.green, onPrimary = Pnd.onGreen, secondary = Pnd.greenText, onSecondary = Pnd.onGreen,
    background = Pnd.bg, onBackground = Pnd.text, surface = Pnd.panel, onSurface = Pnd.text,
    surfaceVariant = Pnd.card, onSurfaceVariant = Pnd.textSoft, outline = Pnd.inputBorder, error = Pnd.badText,
    surfaceContainer = Pnd.panel, surfaceContainerHigh = Pnd.panel2, surfaceContainerHighest = Pnd.panel2, surfaceContainerLow = Pnd.card,
)

/** Native minimum sizes from design.md §2; everything scales with the system font size. */
private val type = Typography(
    headlineLarge = TextStyle(fontSize = 28.sp, lineHeight = 34.sp, fontWeight = FontWeight.Bold, color = Pnd.text),
    headlineSmall = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Bold),
    titleLarge = TextStyle(fontSize = 20.sp, lineHeight = 26.sp, fontWeight = FontWeight.Bold),
    titleMedium = TextStyle(fontSize = 17.sp, lineHeight = 22.sp, fontWeight = FontWeight.Bold),
    titleSmall = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.Bold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 15.sp, lineHeight = 21.sp),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.ExtraBold),
    labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Bold),
    labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 15.sp, fontWeight = FontWeight.ExtraBold, letterSpacing = 0.6.sp),
)

@Composable
fun PndTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = scheme, typography = type) {
        // Plain Text with only a font size gets a line height that follows that size, not the body's.
        androidx.compose.material3.ProvideTextStyle(TextStyle(fontSize = 15.sp, color = Pnd.text), content)
    }
}
