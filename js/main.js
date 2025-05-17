let modal = $("#modal_wrapper");
let modalMessage = $("#modal_message_wrapper");
let modalForm = $("#modal_wrapper form");
let modalText = $("#modal_text");
let modalTitle = $("#modal_title");
let modalTypeForm = $(".type_form");

$(document).ready(function () {
    // Show the modal when the button is clicked
    $(".contact_button").click(function (e) {
        //e.preventDefault(); // Prevent default anchor click behavior
        showForm("https://formspree.io/f/mnndgnqz", "message", "I will get back to you as soon as possible.");
    });

    $(".endorse_button").click(function (e) {
        //e.preventDefault(); // Prevent default anchor click behavior
        showForm("https://formspree.io/f/movdkdby", 
            "endorsement", 
            `Thank you for taking the time to share your endorsement. Your voice helps 
            uplift this work. Together, we're building something powerful in education.`
        );
    });

    $(".modal_close").click(function (e) {
        console.log("close button clicked");
        //e.preventDefault(); // Prevent default anchor click behavior
        closeModal();
    });

    $("#email_link").on("click", function (e) {
        navigator.clipboard.writeText("nicole@mcree-ed.consulting");

        navigator.clipboard.readText()
            .then(text => {
                showMessage(
                    'E-mail Copied',
                    `<strong>${text}</strong> was copied to your clipboard. In case your email client did not open,
                    you can open your email client manually and paste the address.`
                );
            })
            .catch(err => {
                console.error("Failed to read clipboard contents: ", err);
            });
      });
});

$(function(){
    var $win        = $(window);
    var $heroHeaderWrapper = $('.hero-header-wrapper');
    var $heroHeader = $('.hero-header');//.hide();
    var $heroBgs    = $('.hero-background'); 
    var visible     = false;
  
    // compute header height once (if it’s static)
    var headerH = $('#top_menu').outerHeight() || 0;
  
    function checkHeroScroll(){
      var scrollTop = $win.scrollTop();
  
      // pick the visible hero image (desktop or mobile)
      var $bg = $heroBgs.filter(':visible');
      if (!$bg.length) return;  // safety
  
      // bottom edge of that image
      var bgBottom = $bg.offset().top + $bg.outerHeight();
  
      // define threshold so it accounts for the fixed header
      var threshold = bgBottom - headerH;
  
      if (!visible && scrollTop >= threshold) {
        // scroll down past threshold → fade in
        //$heroHeader.stop(true,true).fadeIn(1000);
        $heroHeaderWrapper.addClass('fade-in');

        visible = true;
      }
      else if (visible && scrollTop < threshold) {
        // scroll up above threshold → fade out
        //$heroHeader.stop(true,true).fadeOut(1000);
        $heroHeaderWrapper.removeClass('fade-in');
        visible = false;
      }
    }
  
    $win.on('scroll resize', checkHeroScroll);
    checkHeroScroll();
  });

function closeModal() {
    modal.addClass("no_display"); 
    modalMessage.addClass("no_display");
    modalForm.addClass("no_display");
    modalForm[0].reset();
}

function showMessage(title, message){
    modalTitle.html(title);
    modalText.html(message);

    modalMessage.removeClass("no_display");
    modal.removeClass("no_display");
}


function showForm(action, type, response) {
    modalForm.attr("action", action);
    modalTypeForm.text(type);
    modalTitle.text("Thank you for sumitting your " + type + ".");
    modalText.text(response);

    modal.removeClass("no_display");
    modalForm.removeClass("no_display");  
}

document.addEventListener("DOMContentLoaded", function () {
    const form = document.querySelector("#modal_wrapper form");

    form.addEventListener("submit", function (e) {
        e.preventDefault(); // stop default form submission so we can handle it manually

        const formData = new FormData(form);

        fetch(form.action, {
            method: form.method,
            body: formData,
            headers: {
                'Accept': 'application/json'
            }
        }).then(response => {
        if (response.ok) {
            modalMessage.removeClass("no_display");
            modalForm.addClass("no_display");
            form.reset();
        } else {
            alert("There was a problem submitting the form. Please try again.");
        }
        }).catch(error => {
            alert("There was a problem submitting the form.");
        });
    });
});