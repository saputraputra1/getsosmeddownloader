package com.earthspace.monitor.repository

import com.earthspace.monitor.api.AdvancedApiClient
import com.earthspace.monitor.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

class FloodRepository {

    /**
     * Mengambil data banjir (Flood) dari PetaBencana.id atau Global Flood Awareness System (GloFAS)
     */
    suspend fun getFloodAlerts(): Resource<List<FloodWarning>> = withContext(Dispatchers.IO) {
        try {
            // Simulasi data untuk demo
            delay(500)
            val dummy = listOf(
                FloodWarning("1", "Sungai Kampar", "Riau", "Indonesia", 0.0, 101.0, FloodAlertLevel.ALERT, 1500.0, 5, "2024-03-20"),
                FloodWarning("2", "Sungai Barito", "Kalimantan Tengah", "Indonesia", -1.0, 114.0, FloodAlertLevel.WARNING, 2200.0, 10, "2024-03-20")
            )
            Resource.Success(dummy)
        } catch (e: Exception) {
            Resource.Error("Gagal mengambil data banjir: ${e.message}")
        }
    }
}
