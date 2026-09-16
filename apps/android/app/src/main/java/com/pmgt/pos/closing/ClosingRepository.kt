package com.pmgt.pos.closing

interface ClosingRepository {
    suspend fun currentBusinessDate(storeId: String): String
    suspend fun getStore(storeId: String): ClosingStore
    suspend fun getReport(storeId: String, reportDate: String): DailyClosingReport?
    suspend fun getProductSales(storeId: String, reportDate: String): List<ProductSale>
    suspend fun getPaymentTransactions(storeId: String, reportDate: String): List<PaymentTransactionGroup>
    suspend fun getAttention(storeId: String, reportDate: String): ClosingAttention
    suspend fun generate(storeId: String, reportDate: String, startTime: String?, endTime: String?)
    suspend fun close(storeId: String, reportDate: String)
    suspend fun retry(jobId: String)
}
