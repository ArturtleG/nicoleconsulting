import {
  db,
  collection,
  doc,
  addDoc,
  setDoc,
  serverTimestamp
} from "./firebaseSetup.js";

let modal             = $("#modal_wrapper");
let modalMessage      = $("#modal_message_wrapper");
let modalForm         = $("#modal_wrapper form");
let modalFormHeader   = $("#modal_wrapper #form_heading");
let modalFormMessage  = $("#modal_wrapper #form_message");
let modalText         = $("#modal_text");
let modalTitle        = $("#modal_title");
let modalTypeForm     = $(".type_form");
let modalCloseButtons = $(".modal_close");
let submitButton      = $("[type=submit]");


$(document).ready(function () {
    const params = new URLSearchParams(window.location.search);
    if (params.get('qr') === '1') {
        showContactForm();
    }

    // Show the modal when the button is clicked
    $(".contact_button,#icon_contact").click(function (e) {
        e.preventDefault();
        showContactForm();
    });

    $(".endorse_button").click(function (e) {
        //e.preventDefault(); // Prevent default anchor click behavior
        showForm(
            //"https://formspree.io/f/movdkdby",
            "endorse",
            "Endorse",
            `I am honored that you felt moved to endorse my work. 
            Your endorsement is a powerful way to support my mission and help others discover the impact of my work.`,
            "endorsement",
            "endorsement", 
            `Thank you for taking the time to share your endorsement. Your voice helps 
            uplift this work. Together, we're building something powerful in education.`
        );
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

      modalCloseButtons.click(function (e) {
        console.log("close button clicked");
        //e.preventDefault(); // Prevent default anchor click behavior
        closeModal(this);
    });

    if (!modalForm.length) {
        console.warn("No form found in #modal_wrapper");
    } else {
        modalForm.on("submit", async function (e) {
            e.preventDefault();

            const name    = this.elements.name.value.trim();
            const email   = this.elements.email.value.trim().toLowerCase();
            const message = this.elements.message.value.trim() || "No message";

            const isEndorse = !!$(this).attr("action").match(/endorse/);
            const subscribeNewsletter =
                !isEndorse && this.elements.subscribe_newsletter?.checked;

            submitButton
                .text("Submitting...")
                .addClass("blink")
                .prop("disabled", true);

            let success = false;

            const emailToId = (value) =>
                value.replace(/[.#$/\[\]]/g, "_");

            try {
                let targetCollection, subjectType, additionalMessage = "";

                if (isEndorse) {
                    targetCollection = "endorsements";
                    subjectType = "New Endorsement";
                } else if (subscribeNewsletter) {
                    targetCollection = "newsletters_email";
                    subjectType = "New Newsletter Subscriber";
                    $("#modal_text").html(`
                        Thank you for subscribing to Roots & Reason! I'm excited to share this journey with 
                        you. Look for my newsletter in your inbox soon.`
                    );
                    //additionalMessage = "<br><br>Look for my Roots & Reason in your inbox soon!";
                } else {
                    targetCollection = "contacts";
                    subjectType = "New Contact";
                }

                // 1) Write to Firestore

                if (targetCollection === "endorsements") {
                    // allow multiple endorsements per email
                    await addDoc(collection(db, "endorsements"), {
                        name,
                        email,
                        message,
                        submittedAt: serverTimestamp(),
                        source: "endorsement_form",
                    });
                } else {
                    // contacts & newsletters_email: one per email (overwrites allowed)
                    const id = emailToId(email);
                    const base = {
                        name,
                        email,
                        message,
                        source:
                            targetCollection === "contacts"
                                ? "contact_form"
                                : "newsletter_form",
                    };

                    await setDoc(
                        doc(db, targetCollection, id),
                        targetCollection === "contacts"
                            ? { ...base, submittedAt: serverTimestamp() }
                            : { ...base, subscribedAt: serverTimestamp() },
                        { merge: true } // keeps it idempotent/future-proof
                    );
                }

                // 2) Send notification email

                await addDoc(collection(db, "mail"), {
                    to: isEndorse
                        ? ["web@mcree-ed.consulting"]
                        //: ["web@mcree-ed.consulting", "nicole@mcree-ed.consulting"],
                        : ["web@mcree-ed.consulting"],
                    message: {
                        subject: `${subjectType}: ${name || "Anonymous"}`,
                        text:
                            `Email: ${email}\n\n${message}`,
                        html: `
                            <p><strong>Name:</strong> ${name}</p>
                            <p><strong>Email:</strong> ${email}</p>
                            <div style="
                                border: 2px solid #004c6d;
                                border-left: 8px solid #004c6d;
                                border-radius: 12px;
                                margin: 1em 4em 1em 2em;
                                padding: 2em;
                                color: #222;
                                font-family: Tahoma, sans-serif;
                                font-size: 1.2em;">
                                ${message.replace(/\n/g, "<br/>")}
                            </div>`
                    },
                });

                success = true;

            } catch (err) {
                console.error("Submit error:", err);
                alert("There was a problem submitting the form. Please try again.");
            } finally {
                submitButton
                    .text("Submit")
                    .removeClass("blink")
                    .prop("disabled", false);

                if (success) {
                    modalForm.addClass("no_display");
                    modalMessage.removeClass("no_display");
                    this.reset();
                } else {
                    modalForm.removeClass("no_display");
                    modalMessage.addClass("no_display");
                }
            }
        });

    }
});

$(function(){
    var $win        = $(window);
    var $heroHeaderWrapper = $('.hero-header-wrapper');
    //var $heroHeader = $('.hero-header');//.hide();
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
        $heroHeaderWrapper.addClass('fade-in');

        visible = true;
      }
      else if (visible && scrollTop < threshold) {
        $heroHeaderWrapper.removeClass('fade-in');
        visible = false;
      }
    }
  
    $win.on('scroll resize', checkHeroScroll);
    checkHeroScroll();
});

$(function(){
    var $win        = $(window);
    var servicesWrapperTop = $('[show_contact]').offset().top;
    let visible     = false;
    let scrollEnabled = sessionStorage.getItem('contactAutoShown') !== 'yes';
  
    // compute header height once (if it’s static)
    var headerS = $('#top_menu').outerHeight() || 0;

    var threshold = servicesWrapperTop - headerS;
  
    function checkContactScroll(){
        var scrollTop = $win.scrollTop();

        if (!visible && scrollTop >= threshold && scrollEnabled) {
            showContactForm();
            visible = true;
            sessionStorage.setItem('contactAutoShown', 'yes');
        }
        else if (visible && scrollTop < threshold) {
            //$heroHeaderWrapper.removeClass('fade-in');
            //visible = false;
        }
    }
  
    $win.on('scroll resize', checkContactScroll);
    checkContactScroll();
});

function showContactForm(){
    showForm(
        //"https://formspree.io/f/mnndgnqz",
        "contact",
        "Contact",
        `<p>
            Subscribe to “Roots & Reason”, a newsletter that explores fresh ideas, practical strategies, 
            and professional learning resources.  Want to connect or collaborate? Leave a message and 
            I'll be in touch soon!
        </p>
        <div class="button_wrapper u-flex-center">
            <a href="https://drive.google.com/drive/folders/1Prrg3mlEv0TZ6Ha174LWF4ufzyHZMR8n?usp=sharing" target="_blank" class="primary-button">
                Click for Samples
            </a>
            <div>
                <label for="subscribe_newsletter">Subscribe to my Newsletter!!!
                    <input type="checkbox" id="subscribe_newsletter" name="subscribe_newsletter" value="yes" />
                </label>
            </div>
        </div>`,
        "message (optional)",
        "contact info",
        "I will get back to you as soon as possible.",
        "showContactButton"
    )
}

const callbacks = {
    showContactButton
}

function closeModal(buttonClicked) {
    //modal.addClass("no_display");
    modal.fadeOut(800);
    modalMessage.addClass("no_display");
    modalForm.addClass("no_display");
    modalForm.each(function() {
        $(this)[0].reset();
    })

    console.log("buttonClicked:", buttonClicked);

    let callback = $(buttonClicked).closest("form").attr("callback");

    console.log("closeModal callback:", callback);

    if(callback && callbacks[callback] && typeof callbacks[callback] === 'function') {
        console.log("Executing callback function:", callback);
        callbacks[callback].call();
        $(buttonClicked).closest("form").attr("callback","");
    }
}

function showContactButton(){
    console.log("showContactButton called");
    //$("#icon_contact").css("opacity", 0).removeClass("no_display");
    gsap.to(
        "#icon_contact", 
        {
            scale:1.3,
            duration: .8, 
            yoyoEase: "easyInOut",
            yoyo: true, 
            repeat:1,
            onComplete() {
                // remove anything left over on the "style" attribute
                document.querySelector("#icon_contact")?.removeAttribute("style");
            }
        }
    );
}

function showMessage(title, message){
    modalTitle.html(title);
    modalText.html(message);

    modalMessage.removeClass("no_display");
    
    modal.css("display", "flex")
        .hide()
        .fadeIn();
}


function showForm(action, header, message, type, supText, response, callback=null) {
    modalForm.attr("action", action);
    modalTypeForm.text(type);
    modalFormHeader.text(header + " Nicole");
    modalFormMessage.html(message);
    modalTitle.text("Thank you for submitting your " + supText + ".");
    modalText.text(response);

    console.log("showForm header:", header);
    console.log("showForm callback:", callback);

    if(callback)
        modalForm.attr("callback", callback);

    //modal.removeClass("no_display");
    modalForm.removeClass("no_display");

    modal.css("display", "flex")
    .hide()
    .fadeIn(800);
}