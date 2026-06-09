package com.earthspace.monitor.repository

import com.earthspace.monitor.api.AdvancedApiClient
import com.earthspace.monitor.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

class SpaceDebrisRepository {

    /**
     * Get summary of space debris from CelesTrak or simulated data.
     */
    suspend fun getDebrisSummary(): Resource<SpaceDebrisSummary> = withContext(Dispatchers.IO) {
        try {
            // Simulated data
            delay(800)
            val summary = SpaceDebrisSummary(
                totalObjects = 26500,
                payloads = 8400,
                rocketBodies = 2500,
                debris = 15200,
                unknown = 400,
                byCountry = mapOf("USA" to 8500, "Russia" to 7000, "China" to 5000, "Other" to 6000),
                byOrbitType = mapOf("LEO" to 22000, "MEO" to 2000, "GEO" to 2000, "HEO" to 500),
                lastUpdated = "2024-03-20 12:00:00"
            )
            Resource.Success(summary)
        } catch (e: Exception) {
            Resource.Error("Gagal mengambil data puing luar angkasa: ${e.message}")
        }
    }
}
