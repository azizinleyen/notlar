// ============================================================================
//  Cihaz/akis yardimcilari (mikrofon secimi, sistem sesi loopback)
// ============================================================================

import type { MediaDeviceInfoLite } from '@shared/types'

/** Mikrofon izni alir (cihaz etiketlerinin gorunmesi icin gerekir). */
export async function ensureMicPermission(): Promise<boolean> {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true })
    s.getTracks().forEach((t) => t.stop())
    return true
  } catch {
    return false
  }
}

export async function listAudioInputs(): Promise<MediaDeviceInfoLite[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((d) => d.kind === 'audioinput')
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Mikrofon ${i + 1}` }))
}

/** Mikrofon akisi. AGC kapali (ham ses daha temiz), yankı engelleme acik. */
export async function openMicStream(deviceId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      channelCount: 1
    }
  })
}

/**
 * Sistem sesi (Windows WASAPI loopback) akisi.
 * Main tarafindaki setDisplayMediaRequestHandler audio:'loopback' saglar.
 */
export async function openSystemStream(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: true
  })
  // Video karesine ihtiyacimiz yok. Silmek yerine DEVRE DISI birakiyoruz:
  // bazi surumlerde video track'i stop() etmek ses kanalini da kapatabiliyor.
  stream.getVideoTracks().forEach((t) => {
    t.enabled = false
  })
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('Sistem sesi yakalanamadi (loopback desteklenmiyor olabilir)')
  }
  return stream
}