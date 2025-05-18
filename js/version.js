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
          if (lm) {
            var d    = new Date(lm);
            var yyyy = d.getFullYear();
            var MM   = String(d.getMonth() + 1).padStart(2, '0');
            var dd   = String(d.getDate()).padStart(2, '0');
            var hh   = String(d.getHours()).padStart(2, '0');
            var mi   = String(d.getMinutes()).padStart(2, '0');
            var ss   = String(d.getSeconds()).padStart(2, '0');
            var msec = String(d.getMilliseconds()).padStart(3, '0');

            var versionString = 
              yyyy + '.' +
              MM   + '.' +
              dd   + '.' +
              hh   + '.' +
              mi   + '.' +
              ss   + '.' +
              msec;

            $el.attr(attr, url + '?v=' + versionString);
          }
        }
      });
    });
  });