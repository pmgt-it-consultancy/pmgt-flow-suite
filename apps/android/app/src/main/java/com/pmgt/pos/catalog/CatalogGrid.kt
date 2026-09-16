package com.pmgt.pos.catalog

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.*
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pmgt.pos.R
import com.pmgt.pos.browse.*

/** Embedded menu only. The editor owns its header/cart, selected snapshot and all writes. */
@Composable
fun CatalogMenu(
    storeId: String,
    repository: CatalogRepository,
    onSelectProduct: (SelectedProduct) -> Unit,
    modifier: Modifier = Modifier,
    active: Boolean = true,
) {
    key(storeId, repository) {
        val flow = remember(repository, storeId) { repository.catalog(storeId) }
        var retained by remember { mutableStateOf<Catalog?>(null) }
        val displayed =
            if (active) {
                val current by flow.collectAsStateWithLifecycle(initialValue = retained)
                SideEffect { retained = current }
                current
            } else {
                retained
            }
        CatalogGrid(displayed, onSelectProduct, modifier)
    }
}

@Composable
fun CatalogGrid(
    catalog: Catalog?,
    onSelectProduct: (SelectedProduct) -> Unit,
    modifier: Modifier = Modifier,
) {
    var categoryId by rememberSaveable { mutableStateOf<String?>(null) }
    var categoryName by rememberSaveable { mutableStateOf<String?>(null) }
    var subcategoryId by rememberSaveable { mutableStateOf<String?>(null) }
    var search by rememberSaveable { mutableStateOf("") }
    val nav = CatalogNavigation(categoryId, categoryName, subcategoryId)
    val tiles = remember(catalog, nav, search) { catalog?.tiles(nav, search).orEmpty() }
    Column(modifier) {
        Row(
            Modifier.padding(start = 12.dp, end = 12.dp, top = 12.dp, bottom = 4.dp)
                .fillMaxWidth()
                .background(BrowseColors.Background, RoundedCornerShape(12.dp))
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            CatalogIcon(0xf563, 18, Color(0xFF9CA3AF))
            BasicTextField(
                search,
                { search = it },
                Modifier.weight(1f).padding(start = 10.dp).testTag("catalog-search").semantics {
                    contentDescription = "Search products"
                },
                singleLine = true,
                textStyle = TextStyle(fontSize = 14.sp, color = BrowseColors.Ink),
                decorationBox = { inner ->
                    Box {
                        if (search.isEmpty()) Label("Search products...", 14, Color(0xFF9CA3AF))
                        inner()
                    }
                },
            )
            if (search.isNotEmpty())
                Box(
                    Modifier.clickable { search = "" }
                        .semantics { contentDescription = "Clear product search" }
                ) {
                    CatalogIcon(0xf24b, 18, Color(0xFF9CA3AF))
                }
        }
        if (catalog == null && search.isEmpty()) {
            Column(
                Modifier.fillMaxSize(),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                CircularProgressIndicator(color = BrowseColors.Brand)
                Spacer(Modifier.height(16.dp))
                Label("Loading menu", 16, weight = FontWeight.SemiBold)
                Label("Fetching categories and products for this store.", 14, BrowseColors.Muted)
            }
        } else {
            if (categoryId != null && search.isEmpty())
                Row(
                    Modifier.fillMaxWidth()
                        .catalogPress {
                            val back = nav.back()
                            categoryId = back.categoryId
                            categoryName = back.categoryName
                            subcategoryId = back.subcategoryId
                        }
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                        .semantics { contentDescription = "Catalog back" },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Ion(Glyph.Back, 20, BrowseColors.Brand)
                    Spacer(Modifier.width(6.dp))
                    Label(
                        if (subcategoryId == null) "Categories" else categoryName.orEmpty(),
                        14,
                        BrowseColors.Brand,
                        FontWeight.SemiBold,
                    )
                }
            BoxWithConstraints(Modifier.weight(1f)) {
                val available = maxWidth - 12.dp
                LazyColumn(
                    Modifier.fillMaxSize().testTag("catalog-grid"),
                    contentPadding = PaddingValues(6.dp),
                ) {
                    if (tiles.isEmpty())
                        item {
                            Column(
                                Modifier.fillMaxWidth().padding(vertical = 64.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                CatalogIcon(
                                    if (search.isEmpty()) 0xf356 else 0xf563,
                                    40,
                                    Color(0xFFD1D5DB),
                                )
                                Spacer(Modifier.height(12.dp))
                                Label(
                                    if (search.isEmpty()) "No categories available"
                                    else "No products found",
                                    16,
                                    BrowseColors.Muted,
                                )
                            }
                        }
                    items(tiles.chunked(3)) { row ->
                        Row(Modifier.fillMaxWidth()) {
                            val width =
                                minOf((available - 12.dp * row.size) / row.size, available * .315f)
                            row.forEach { tile ->
                                key(tile.id) {
                                    CatalogCard(tile, Modifier.padding(6.dp).width(width)) {
                                        when (tile) {
                                            is CatalogTile.Product ->
                                                onSelectProduct(tile.product.snapshot())
                                            is CatalogTile.Category ->
                                                if (categoryId == null) {
                                                    categoryId = tile.id
                                                    categoryName = tile.category.name
                                                } else subcategoryId = tile.id
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun CatalogCard(tile: CatalogTile, modifier: Modifier, onClick: () -> Unit) {
    val category = tile is CatalogTile.Category
    Column(
        modifier
            .heightIn(min = 100.dp)
            .clip(RoundedCornerShape(12.dp))
            .background(if (category) Color(0xFFEFF6FF) else Color.White)
            .border(
                1.dp,
                if (category) Color(0xFFBFDBFE) else BrowseColors.Border,
                RoundedCornerShape(12.dp),
            )
            .catalogPress(onClick = onClick)
            .testTag("catalog-tile-${tile.id}")
            .padding(16.dp),
        verticalArrangement = Arrangement.SpaceBetween,
    ) {
        when (tile) {
            is CatalogTile.Category -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        tile.category.name,
                        Modifier.weight(1f).padding(end = 8.dp),
                        color = Color(0xFF1E3A5F),
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                        letterSpacing = 0.sp,
                    )
                    CatalogIcon(0xf327, 20, Color(0xFF1E40AF))
                }
                Spacer(Modifier.height(8.dp))
                Label(
                    "${tile.count} ${if(tile.count==1) "item" else "items"}",
                    12,
                    BrowseColors.Brand,
                )
            }
            is CatalogTile.Product -> {
                val p = tile.product
                Text(
                    p.name,
                    color = BrowseColors.Ink,
                    fontSize = 16.sp,
                    fontWeight = FontWeight.SemiBold,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                    letterSpacing = 0.sp,
                )
                if (!p.isVatable) {
                    Spacer(Modifier.height(8.dp))
                    CatalogChip("NON-VAT", 12, Color(0xFFA16207), Color(0xFFFEF3C7), 8, 2, 4)
                }
                Spacer(Modifier.height(12.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    CatalogChip(
                        if (p.isOpenPrice) "Enter Price" else money(p.price),
                        14,
                        if (p.isOpenPrice) Color(0xFF059669) else Color(0xFF2563EB),
                        if (p.isOpenPrice) Color(0xFFECFDF5) else Color(0xFFEFF6FF),
                        12,
                        6,
                        8,
                        FontWeight.Bold,
                    )
                    if (p.hasModifiers) {
                        Spacer(Modifier.width(6.dp))
                        CatalogChip("Custom", 10, Color(0xFFD97706), Color(0xFFFFFBEB), 8, 4, 4)
                    }
                }
            }
        }
    }
}

@Composable
internal fun CatalogChip(
    text: String,
    size: Int,
    color: Color,
    bg: Color,
    h: Int,
    v: Int,
    radius: Int,
    weight: FontWeight = FontWeight.Medium,
) {
    Label(
        text,
        size,
        color,
        weight,
        Modifier.background(bg, RoundedCornerShape(radius.dp))
            .padding(horizontal = h.dp, vertical = v.dp),
    )
}

private val CatalogIcons = FontFamily(Font(R.font.ionicons))

@Composable
internal fun CatalogIcon(code: Int, size: Int, color: Color) {
    Text(
        code.toChar().toString(),
        fontFamily = CatalogIcons,
        fontSize = size.sp,
        color = color,
        modifier = Modifier.clearAndSetSemantics {},
    )
}
