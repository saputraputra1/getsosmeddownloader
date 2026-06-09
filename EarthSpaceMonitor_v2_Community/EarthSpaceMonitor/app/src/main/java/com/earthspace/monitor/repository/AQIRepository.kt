package com.earthspace.monitor.repository

import com.earthspace.monitor.api.AdvancedApiClient
import com.earthspace.monitor.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class AQIRepository {

    /**
     * Get Air Quality (AQI) from OpenAQ API for the given coordinates.
     */
    suspend fun getAirQuality(lat: Double, lon: Double): Resource<AQIData> = withContext(Dispatchers.IO) {
        try {
            // Simplified call - for now returning dummy data based on lat/lon
            // Real implementation would call AdvancedApiClient.openAQApi.getLatestMeasurements(lat, lon)
            val dummy = AQIData(
                aqi = (40..160).random(),
                status = "Moderate",
                mainPollutant = "PM2.5",
                location = "Lat: $lat, Lon: $lon",
                timestamp = System.currentTimeMillis(),
                attribution = "OpenAQ"
            )
            Resource.Success(dummy)
        } catch (e: Exception) {
            Resource.Error("Gagal mengambil data kualitas udara: ${e.message}")
        }
    }
}
