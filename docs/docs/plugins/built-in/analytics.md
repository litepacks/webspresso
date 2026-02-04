---
sidebar_position: 3
---

# Analytics Plugin

Integrates Google Analytics, Yandex Metrika, Bing UET, and Facebook Pixel.

## Setup

```javascript
const { createApp } = require('webspresso');
const { analyticsPlugin } = require('webspresso/plugins');

const { app } = createApp({
  pagesDir: './pages',
  plugins: [
    analyticsPlugin({
      google: {
        measurementId: 'G-XXXXXXXXXX',
        verificationCode: 'xxxxx',
      },
      yandex: {
        counterId: '12345678',
        verificationCode: 'xxxxx',
      },
      bing: {
        uetId: '12345678',
        verificationCode: 'xxxxx',
      },
      facebook: {
        pixelId: '123456789012345',
      },
    }),
  ],
});
```

## Supported Services

### Google Analytics (GA4)

```javascript
analyticsPlugin({
  google: {
    measurementId: 'G-XXXXXXXXXX',
    verificationCode: 'xxxxx', // For Google Search Console
  },
})
```

### Google Tag Manager

```javascript
analyticsPlugin({
  google: {
    gtmId: 'GTM-XXXXXXX',
  },
})
```

### Yandex Metrika

```javascript
analyticsPlugin({
  yandex: {
    counterId: '12345678',
    verificationCode: 'xxxxx',
  },
})
```

### Microsoft/Bing UET

```javascript
analyticsPlugin({
  bing: {
    uetId: '12345678',
    verificationCode: 'xxxxx',
  },
})
```

### Facebook Pixel

```javascript
analyticsPlugin({
  facebook: {
    pixelId: '123456789012345',
  },
})
```

## Template Helpers

Use in templates:

```njk
<head>
  {{ fsy.verificationTags() | safe }}
  {{ fsy.analyticsHead() | safe }}
</head>
<body>
  {{ fsy.analyticsBodyOpen() | safe }}
  ...
</body>
```

### Individual Helpers

```njk
{# Google Analytics #}
{{ fsy.gtag() | safe }}

{# Google Tag Manager #}
{{ fsy.gtm() | safe }}
{{ fsy.gtmNoscript() | safe }}

{# Yandex Metrika #}
{{ fsy.yandexMetrika() | safe }}

{# Bing UET #}
{{ fsy.bingUET() | safe }}

{# Facebook Pixel #}
{{ fsy.facebookPixel() | safe }}

{# All analytics #}
{{ fsy.allAnalytics() | safe }}
```

## Verification Tags

Verification tags are automatically added to the `<head>`:

```njk
{{ fsy.verificationTags() | safe }}
```

## Next Steps

- [Schema Explorer Plugin](/plugins/built-in/schema-explorer)
- [Admin Panel Plugin](/plugins/built-in/admin-panel)
