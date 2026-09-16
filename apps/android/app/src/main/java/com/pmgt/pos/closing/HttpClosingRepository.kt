package com.pmgt.pos.closing

import com.pmgt.pos.transport.ConvexHttp
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.*

/** Typed Task 12 boundary over the existing authenticated Convex transport. */
class HttpClosingRepository(private val http: ConvexHttp) : ClosingRepository {
    override suspend fun currentBusinessDate(storeId: String): String =
        http.query("reports:getCurrentBusinessDate", storeArgs(storeId)).jsonPrimitive.content.also(::requireDate)

    override suspend fun getStore(storeId: String): ClosingStore {
        val value = http.query("stores:get", storeArgs(storeId))
        require(value !is JsonNull) { "Store is unavailable" }
        val row = value.jsonObject
        return ClosingStore(
            id = row.text("_id"),
            name = row.text("name"),
            address1 = row.text("address1"),
            address2 = row.optionalText("address2"),
            tin = row.text("tin"),
            schedule = row["schedule"]?.takeUnless { it is JsonNull }?.jsonObject?.toSchedule(),
        )
    }

    override suspend fun getReport(storeId: String, reportDate: String): DailyClosingReport? {
        requireDate(reportDate)
        val value = http.query("reports:getDailyReport", selectionArgs(storeId, reportDate))
        if (value is JsonNull) return null
        val row = value.jsonObject
        return DailyClosingReport(
            id = row.text("_id"),
            reportDate = row.text("reportDate"),
            startTime = row.optionalText("startTime"),
            endTime = row.optionalText("endTime"),
            grossSales = row.number("grossSales"),
            vatableSales = row.number("vatableSales"),
            vatAmount = row.number("vatAmount"),
            vatExemptSales = row.number("vatExemptSales"),
            nonVatSales = row.number("nonVatSales"),
            netSales = row.number("netSales"),
            seniorDiscounts = row.number("seniorDiscounts"),
            pwdDiscounts = row.number("pwdDiscounts"),
            promoDiscounts = row.number("promoDiscounts"),
            manualDiscounts = row.number("manualDiscounts"),
            totalDiscounts = row.number("totalDiscounts"),
            voidCount = row.count("voidCount"),
            voidAmount = row.number("voidAmount"),
            cashTotal = row.number("cashTotal"),
            cardEwalletTotal = row.number("cardEwalletTotal"),
            transactionCount = row.count("transactionCount"),
            averageTicket = row.number("averageTicket"),
            generatedAt = row.long("generatedAt"),
            generatedByName = row.text("generatedByName"),
            isPrinted = row.boolean("isPrinted"),
            printedAt = row.optionalLong("printedAt"),
        )
    }

    override suspend fun getProductSales(storeId: String, reportDate: String): List<ProductSale> {
        requireDate(reportDate)
        return http.query("reports:getDailyProductSales", selectionArgs(storeId, reportDate)).jsonArray.map {
            val row = it.jsonObject
            ProductSale(
                productId = row.text("productId"),
                productName = row.text("productName"),
                categoryId = row.text("categoryId"),
                categoryName = row.text("categoryName"),
                parentCategoryName = row.text("parentCategoryName"),
                quantitySold = row.number("quantitySold"),
                grossAmount = row.number("grossAmount"),
                voidedQuantity = row.number("voidedQuantity"),
                voidedAmount = row.number("voidedAmount"),
            )
        }
    }

    override suspend fun getPaymentTransactions(
        storeId: String,
        reportDate: String,
    ): List<PaymentTransactionGroup> {
        requireDate(reportDate)
        return http.query("reports:getDailyPaymentTransactions", selectionArgs(storeId, reportDate)).jsonArray.map {
            val row = it.jsonObject
            PaymentTransactionGroup(
                paymentType = row.text("paymentType"),
                transactions = row.getValue("transactions").jsonArray.map { value ->
                    val transaction = value.jsonObject
                    PaymentTransaction(
                        orderId = transaction.text("orderId"),
                        orderNumber = transaction.text("orderNumber"),
                        referenceNumber = transaction.text("referenceNumber"),
                        amount = transaction.number("amount"),
                        paidAt = transaction.long("paidAt"),
                    )
                },
                subtotal = row.number("subtotal"),
            )
        }
    }

    override suspend fun getAttention(storeId: String, reportDate: String): ClosingAttention =
        coroutineScope {
            requireDate(reportDate)
            val args = selectionArgs(storeId, reportDate)
            val jobs = async { http.query("closing:getPendingTotalsReconciliations", args) }
            val divergences = async { http.query("closing:getTotalsDivergences", args) }
            ClosingAttention(
                jobs = jobs.await().jsonArray.map { value ->
                    val row = value.jsonObject
                    ReconciliationJob(
                        jobId = row.text("jobId"),
                        orderId = row.text("orderId"),
                        mutationId = row.text("mutationId"),
                        status =
                            when (row.text("status")) {
                                "pending" -> ReconciliationStatus.Pending
                                "failed" -> ReconciliationStatus.Failed
                                else -> error("Unsupported reconciliation status")
                            },
                        blockedReason = row.optionalText("blockedReason"),
                    )
                },
                divergences = divergences.await().jsonArray.map { value ->
                    val row = value.jsonObject
                    TotalsDivergence(
                        orderId = row.text("orderId"),
                        deviceTotals = row.numberRecord("deviceTotals"),
                        reconciledTotals = row.numberRecord("reconciledTotals"),
                        fields = row.getValue("fields").jsonArray.map { it.jsonPrimitive.content },
                    )
                },
            )
        }

    override suspend fun generate(
        storeId: String,
        reportDate: String,
        startTime: String?,
        endTime: String?,
    ) {
        requireDate(reportDate)
        require((startTime == null) == (endTime == null))
        http.mutation(
            "reports:generateDailyReport",
            buildJsonObject {
                put("storeId", storeId)
                put("reportDate", reportDate)
                startTime?.let { put("startTime", it) }
                endTime?.let { put("endTime", it) }
            },
        )
    }

    override suspend fun close(storeId: String, reportDate: String) {
        requireDate(reportDate)
        http.mutation("closing:logDayClosing", selectionArgs(storeId, reportDate))
    }

    override suspend fun retry(jobId: String) {
        require(jobId.isNotBlank())
        http.mutation("closing:retryTotalsReconciliation", buildJsonObject { put("jobId", jobId) })
    }
}

private fun storeArgs(storeId: String) = buildJsonObject {
    require(storeId.isNotBlank())
    put("storeId", storeId)
}

private fun selectionArgs(storeId: String, reportDate: String) = buildJsonObject {
    require(storeId.isNotBlank())
    put("storeId", storeId)
    put("reportDate", reportDate)
}

private fun JsonObject.toSchedule() =
    StoreSchedule(
        monday = slot("monday"),
        tuesday = slot("tuesday"),
        wednesday = slot("wednesday"),
        thursday = slot("thursday"),
        friday = slot("friday"),
        saturday = slot("saturday"),
        sunday = slot("sunday"),
    )

private fun JsonObject.slot(key: String): ScheduleSlot {
    val row = getValue(key).jsonObject
    return ScheduleSlot(row.text("open"), row.text("close"))
}

private fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.let {
    require(it.isString) { "$key must be a string" }
    it.content
}

private fun JsonObject.optionalText(key: String): String? =
    get(key)?.takeUnless { it is JsonNull }?.jsonPrimitive?.let {
        require(it.isString) { "$key must be a string" }
        it.content
    }

private fun JsonObject.number(key: String): Double = getValue(key).jsonPrimitive.let {
    val value = it.doubleOrNull
    require(!it.isString && value != null && value.isFinite()) { "$key must be a finite JSON number" }
    value
}

private fun JsonObject.count(key: String): Int {
    val value = number(key)
    require(value >= Int.MIN_VALUE && value <= Int.MAX_VALUE && value % 1.0 == 0.0) {
        "$key must be an integral Int-range JSON number"
    }
    return value.toInt()
}

private fun JsonObject.long(key: String): Long {
    val primitive = getValue(key).jsonPrimitive
    val value = primitive.doubleOrNull
    require(!primitive.isString && value != null && value.isFinite() && value % 1.0 == 0.0) {
        "$key must be an integral JSON number"
    }
    return primitive.longOrNull ?: value.toLong()
}

private fun JsonObject.optionalLong(key: String): Long? =
    get(key)?.takeUnless { it is JsonNull }?.let { JsonObject(mapOf(key to it)).long(key) }

private fun JsonObject.boolean(key: String): Boolean = getValue(key).jsonPrimitive.let {
    require(!it.isString && it.booleanOrNull != null) { "$key must be a JSON boolean" }
    it.boolean
}

private fun JsonObject.numberRecord(key: String): Map<String, Double> =
    getValue(key).jsonObject.mapValues { (field, value) ->
        JsonObject(mapOf(field to value)).number(field)
    }

private fun requireDate(value: String) {
    require(Regex("\\d{4}-\\d{2}-\\d{2}").matches(value)) { "Invalid report date" }
    java.time.LocalDate.parse(value)
}
