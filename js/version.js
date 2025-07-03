$(function(){
  $('[data-version]').each(function(){
    var $el  = $(this);
    var attr = $el.is('script') ? 'src' : 'href';
    var url  = $el.attr(attr);

    // HEAD request to fetch the Last-Modified header
    $.ajax({
      type: 'HEAD',
      url: url,
      success: function(data, status, xhr) {
        var lm = xhr.getResponseHeader('Last-Modified');
        if (!lm) return;

        // build your timestamp‐based version string
        var d    = new Date(lm);
        var yyyy = d.getFullYear();
        var MM   = String(d.getMonth() + 1).padStart(2, '0');
        var dd   = String(d.getDate()).padStart(2, '0');
        var hh   = String(d.getHours()).padStart(2, '0');
        var mi   = String(d.getMinutes()).padStart(2, '0');
        var ss   = String(d.getSeconds()).padStart(2, '0');
        var versionString = yyyy + '-' + MM + '-' + dd + '_' + hh + ':' + mi + ':' + ss;
        
        // choose separator based on existing “?”
        var sep = url.indexOf('?') === -1 ? '?' : '&';
        $el.attr(attr, url + sep + 'ts=' + versionString);
      }
    });
  });
});