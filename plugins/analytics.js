/**
 * Webspresso Analytics Plugin
 * Adds tracking scripts and verification meta tags for Google, Yandex, and Bing
 */

/**
 * Generate Google Analytics (gtag.js) script
 */
function generateGtagScript(config) {
  if (!config || !config.measurementId) return '';
  
  const { measurementId, adsId } = config;
  
  let script = `<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=${measurementId}"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', '${measurementId}');`;
  
  if (adsId) {
    script += `
  gtag('config', '${adsId}');`;
  }
  
  script += `
</script>`;
  
  return script;
}

/**
 * Generate Google Tag Manager script
 */
function generateGtmScript(config) {
  if (!config || !config.containerId) return '';
  
  const { containerId } = config;
  
  return `<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${containerId}');</script>`;
}

/**
 * Generate Google Tag Manager noscript fallback
 */
function generateGtmNoscript(config) {
  if (!config || !config.containerId) return '';
  
  return `<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${config.containerId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
}

/**
 * Generate Yandex.Metrika script
 */
function generateYandexScript(config) {
  if (!config || !config.counterId) return '';
  
  const { counterId, clickmap = true, trackLinks = true, accurateTrackBounce = true, webvisor = false } = config;
  
  return `<!-- Yandex.Metrika -->
<script>
   (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
   m[i].l=1*new Date();
   for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
   k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
   (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");

   ym(${counterId}, "init", {
        clickmap:${clickmap},
        trackLinks:${trackLinks},
        accurateTrackBounce:${accurateTrackBounce}${webvisor ? ',\n        webvisor:true' : ''}
   });
</script>
<noscript><div><img src="https://mc.yandex.ru/watch/${counterId}" style="position:absolute; left:-9999px;" alt="" /></div></noscript>`;
}

/**
 * Generate Microsoft/Bing UET script
 */
function generateBingScript(config) {
  if (!config || !config.uetId) return '';
  
  const { uetId } = config;
  
  return `<!-- Microsoft UET -->
<script>
(function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[],f=function(){var o={ti:"${uetId}",enableAutoSpaTracking:true};
o.q=w[u],w[u]=new UET(o),w[u].push("pageLoad")},n=d.createElement(t),n.src=r,n.async=1,n.onload=n.onreadystatechange=function(){
var s=this.readyState;s&&s!=="loaded"&&s!=="complete"||(f(),n.onload=n.onreadystatechange=null)},i=d.getElementsByTagName(t)[0],i.parentNode.insertBefore(n,i)
})(window,document,"script","//bat.bing.com/bat.js","uetq");
</script>`;
}

/**
 * Generate Facebook Pixel script
 */
function generateFacebookScript(config) {
  if (!config || !config.pixelId) return '';
  
  const { pixelId } = config;
  
  return `<!-- Facebook Pixel -->
<script>
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${pixelId}');
fbq('track', 'PageView');
</script>
<noscript><img height="1" width="1" style="display:none"
src="https://www.facebook.com/tr?id=${pixelId}&ev=PageView&noscript=1"/></noscript>`;
}

/**
 * Generate verification meta tags
 */
function generateVerificationTags(options) {
  const tags = [];
  
  if (options.google?.verificationCode) {
    tags.push(`<meta name="google-site-verification" content="${options.google.verificationCode}">`);
  }
  
  if (options.yandex?.verificationCode) {
    tags.push(`<meta name="yandex-verification" content="${options.yandex.verificationCode}">`);
  }
  
  if (options.bing?.verificationCode) {
    tags.push(`<meta name="msvalidate.01" content="${options.bing.verificationCode}">`);
  }
  
  if (options.facebook?.domainVerification) {
    tags.push(`<meta name="facebook-domain-verification" content="${options.facebook.domainVerification}">`);
  }
  
  if (options.pinterest?.verificationCode) {
    tags.push(`<meta name="p:domain_verify" content="${options.pinterest.verificationCode}">`);
  }
  
  return tags.join('\n');
}

/**
 * Create the analytics plugin
 * @param {Object} options - Plugin options
 * @param {Object} options.google - Google Analytics config
 * @param {string} options.google.measurementId - GA4 Measurement ID (G-XXXXXXXXXX)
 * @param {string} options.google.adsId - Google Ads ID (AW-XXXXXXXXXX)
 * @param {string} options.google.verificationCode - Search Console verification
 * @param {Object} options.gtm - Google Tag Manager config
 * @param {string} options.gtm.containerId - GTM Container ID (GTM-XXXXXXX)
 * @param {Object} options.yandex - Yandex.Metrika config
 * @param {string} options.yandex.counterId - Yandex counter ID
 * @param {string} options.yandex.verificationCode - Yandex Webmaster verification
 * @param {boolean} options.yandex.webvisor - Enable Webvisor
 * @param {Object} options.bing - Microsoft/Bing config
 * @param {string} options.bing.uetId - UET tag ID
 * @param {string} options.bing.verificationCode - Bing Webmaster verification
 * @param {Object} options.facebook - Facebook/Meta config
 * @param {string} options.facebook.pixelId - Facebook Pixel ID
 * @param {string} options.facebook.domainVerification - Domain verification code
 */
function analyticsPlugin(options = {}) {
  const { google, gtm, yandex, bing, facebook, pinterest } = options;
  
  return {
    name: 'analytics',
    version: '1.0.0',
    _options: options,
    
    /**
     * Public API for other plugins
     */
    api: {
      /**
       * Get configuration
       */
      getConfig() {
        return { ...options };
      },
      
      /**
       * Check if a tracker is configured
       */
      hasTracker(name) {
        return !!options[name];
      }
    },
    
    /**
     * Register helpers
     */
    register(ctx) {
      // Google Analytics (gtag.js)
      ctx.addHelper('gtag', () => generateGtagScript(google));
      
      // Google Tag Manager
      ctx.addHelper('gtm', () => generateGtmScript(gtm));
      ctx.addHelper('gtmNoscript', () => generateGtmNoscript(gtm));
      
      // Yandex.Metrika
      ctx.addHelper('yandexMetrika', () => generateYandexScript(yandex));
      
      // Microsoft/Bing UET
      ctx.addHelper('bingUET', () => generateBingScript(bing));
      
      // Facebook Pixel
      ctx.addHelper('facebookPixel', () => generateFacebookScript(facebook));
      
      // Verification meta tags
      ctx.addHelper('verificationTags', () => generateVerificationTags(options));
      
      // All analytics scripts combined
      ctx.addHelper('allAnalytics', () => {
        const scripts = [];
        
        if (google) scripts.push(generateGtagScript(google));
        if (gtm) scripts.push(generateGtmScript(gtm));
        if (yandex) scripts.push(generateYandexScript(yandex));
        if (bing) scripts.push(generateBingScript(bing));
        if (facebook) scripts.push(generateFacebookScript(facebook));
        
        return scripts.filter(Boolean).join('\n\n');
      });
      
      // Head scripts (verification + analytics)
      ctx.addHelper('analyticsHead', () => {
        const parts = [];
        
        // Verification tags first
        const verificationTags = generateVerificationTags(options);
        if (verificationTags) parts.push(verificationTags);
        
        // GTM should be as early as possible
        if (gtm) parts.push(generateGtmScript(gtm));
        
        // Other analytics
        if (google) parts.push(generateGtagScript(google));
        if (yandex) parts.push(generateYandexScript(yandex));
        if (bing) parts.push(generateBingScript(bing));
        if (facebook) parts.push(generateFacebookScript(facebook));
        
        return parts.filter(Boolean).join('\n\n');
      });
      
      // Body open scripts (GTM noscript)
      ctx.addHelper('analyticsBodyOpen', () => {
        return generateGtmNoscript(gtm);
      });
    }
  };
}

module.exports = analyticsPlugin;

