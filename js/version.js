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
            var v = new Date(lm).getTime();
            $el.attr(attr, url + '?v=' + v);
          }
        }
      });
    });
});