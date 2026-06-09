/**
 * Instagram Proxy Helper
 * Mengkonversi URL Instagram CDN ke proxy endpoint untuk menghindari CORS
 */

/**
 * Check if URL is Instagram CDN
 */
function isInstagramCdnUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host.includes('cdninstagram.com') || 
           host.includes('fbcdn.net') || 
           (host.includes('instagram.com') && !parsed.pathname.startsWith('/p/'));
  } catch (e) {
    return false;
  }
}

/**
 * Convert Instagram CDN URL to proxied URL
 */
function getProxiedInstagramUrl(originalUrl) {
  if (!isInstagramCdnUrl(originalUrl)) {
    return originalUrl;
  }
  
  const baseUrl = window.location.origin;
  return `${baseUrl}/api/proxy-instagram?url=${encodeURIComponent(originalUrl)}`;
}

/**
 * Patch media items to use proxy
 */
function patchMediaItemsWithProxy(mediaItems) {
  if (!Array.isArray(mediaItems)) return mediaItems;
  
  return mediaItems.map(item => {
    const patchedItem = { ...item };
    
    // Patch main URL
    if (patchedItem.url && isInstagramCdnUrl(patchedItem.url)) {
      patchedItem.url = getProxiedInstagramUrl(patchedItem.url);
    }
    
    // Patch thumbnail
    if (patchedItem.thumbnail && isInstagramCdnUrl(patchedItem.thumbnail)) {
      patchedItem.thumbnail = getProxiedInstagramUrl(patchedItem.thumbnail);
    }
    
    // Patch formats
    if (Array.isArray(patchedItem.formats)) {
      patchedItem.formats = patchedItem.formats.map(format => {
        const patchedFormat = { ...format };
        if (patchedFormat.url && isInstagramCdnUrl(patchedFormat.url)) {
          patchedFormat.url = getProxiedInstagramUrl(patchedFormat.url);
        }
        return patchedFormat;
      });
    }
    
    return patchedItem;
  });
}

/**
 * Patch complete API response
 */
function patchInstagramResponse(response) {
  if (!response || !response.data) return response;
  
  const patchedResponse = { ...response };
  
  if (Array.isArray(patchedResponse.data)) {
    patchedResponse.data = patchedResponse.data.map(item => {
      if (item.platform === 'instagram' && Array.isArray(item.mediaItems)) {
        return {
          ...item,
          mediaItems: patchMediaItemsWithProxy(item.mediaItems)
        };
      }
      return item;
    });
  }
  
  return patchedResponse;
}

// Export untuk digunakan di index.html
if (typeof window !== 'undefined') {
  window.InstagramProxy = {
    isInstagramCdnUrl,
    getProxiedInstagramUrl,
    patchMediaItemsWithProxy,
    patchInstagramResponse
  };
}
