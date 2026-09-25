/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // "Sade premium defter" paleti - sicak kirik beyaz zemin, yumusak cizgiler
        canvas: '#f6f5f2', // uygulama arka plani
        surface: '#ffffff', // panel/kart yuzeyi
        hairline: '#eceae5', // ince ayrac cizgileri
        hairlineSoft: '#f2f1ed',
        ink: '#1f1e1c', // ana metin
        inkSoft: '#55534e',
        muted: '#8d8a83', // ikincil metin
        faint: '#b4b1a9',
        pill: '#f1f0ec', // secili oge / etiket cipi
        pillHover: '#e9e8e3',
        // kayit / canli yesil
        live: '#16a34a',
        liveSoft: '#dcfce7',
        liveInk: '#166534',
        // transkript balonlari
        bubbleSystem: '#f1f0ec', // gri = sistem sesi (karsi taraf)
        bubbleMic: '#d7f5df', // yesil = mikrofon (ben)
        // birincil koyu buton
        primary: '#242320',
        primaryHover: '#33312d'
      },
      fontFamily: {
        sans: [
          'Inter',
          'ui-sans-serif',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif'
        ]
      },
      boxShadow: {
        card: '0 1px 2px rgba(24, 22, 18, 0.04), 0 1px 3px rgba(24, 22, 18, 0.03)',
        pop: '0 8px 30px rgba(24, 22, 18, 0.12)'
      },
      borderRadius: {
        xl2: '14px'
      }
    }
  },
  plugins: []
}