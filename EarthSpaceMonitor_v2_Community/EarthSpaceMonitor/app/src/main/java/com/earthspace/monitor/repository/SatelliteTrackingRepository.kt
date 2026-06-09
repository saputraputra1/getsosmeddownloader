package com.earthspace.monitor.repository

import com.earthspace.monitor.api.AdvancedApiClient
import com.earthspace.monitor.model.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

class SatelliteTrackingRepository {

    /**
     * Get current ISS Location.
     */
    suspend fun getISSLocation(): Resource<SatelliteInfo> = withContext(Dispatchers.IO) {
        try {
            // Simulated position for demo
            val dummy = SatelliteInfo(
                noradId = 25544,
                name = "ISS (Zarya)",
                category = SatelliteCategory.SPACE_STATION,
                latitude = -3.5,
                longitude = 120.0,
                altitude = 420.0,
                velocity = 27600.0,
                azimuth = 145.0,
                elevation = 25.0,
                timestamp = System.currentTimeMillis()
            )
            Resource.Success(dummy)
        } catch (e: Exception) {
            Resource.Error("Gagal mengambil data ISS: ${e.message}")
        }
    }

    /**
     * Get satellites by category from N2YO or CelesTrak.
     */
    suspend fun getSatellitesByCategory(category: Int): Resource<List<SatelliteInfo>> = withContext(Dispatchers.IO) {
        try {
            // Simulated data
            delay(1000)
            val dummy = listOf(
                SatelliteInfo(25544, "ISS", SatelliteCategory.SPACE_STATION, 0.0, 0.0, 400.0, 27000.0, 0.0, 0.0, System.currentTimeMillis()),
                SatelliteInfo(43013, "NOAA 20", SatelliteCategory.WEATHER, 0.0, 0.0, 800.0, 26000.0, 0.0, 0.0, System.currentTimeMillis())
            )
            Resource.Success(dummy)
        } catch (e: Exception) {
            Resource.Error("Gagal mengambil data satelit: ${e.message}")
        }
    }
}
