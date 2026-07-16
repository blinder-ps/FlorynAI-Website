const nav = document.querySelector('.nav-wrap');
const menu = document.querySelector('.menu');
const links = document.querySelector('.nav-links');
window.addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 24), { passive: true });
menu.addEventListener('click', () => {
  const open = links.classList.toggle('open');
  menu.setAttribute('aria-expanded', open);
  document.body.classList.toggle('menu-open', open);
});
links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => { links.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); document.body.classList.remove('menu-open'); }));
document.addEventListener('keydown', e => { if(e.key === 'Escape'){ links.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); document.body.classList.remove('menu-open'); } });
document.querySelectorAll('[data-scroll]').forEach(b => b.addEventListener('click', () => document.querySelector(b.dataset.scroll)?.scrollIntoView({behavior:'smooth'})));
const observer = new IntersectionObserver(entries => entries.forEach(entry => { if(entry.isIntersecting){ entry.target.classList.add('visible'); observer.unobserve(entry.target); } }), { threshold:.12 });
document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
document.querySelectorAll('details').forEach(detail => detail.addEventListener('toggle', () => { if(detail.open) document.querySelectorAll('details').forEach(other => { if(other !== detail) other.open = false; }); }));
async function submitForm(form, endpoint) {
  const fields = [...form.querySelectorAll('[required]')];
  fields.forEach(field => field.classList.toggle('invalid', !field.checkValidity()));
  const invalid = fields.find(field => !field.checkValidity());
  if (invalid) { invalid.focus(); return; }

  const button = form.querySelector('button[type="submit"]');
  const error = form.querySelector('.form-error') || document.createElement('p');
  if (!error.parentNode) { error.className = 'form-error'; error.setAttribute('role', 'alert'); form.appendChild(error); }
  error.hidden = true;
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Sending…';

  try {
    const payload = Object.fromEntries(new FormData(form).entries());
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'same-origin'
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (result.fields && typeof result.fields === 'object') {
        const messages = [];
        Object.entries(result.fields).forEach(([name, fieldMessages]) => {
          const field = form.elements.namedItem(name);
          if (field) field.classList.add('invalid');
          if (Array.isArray(fieldMessages)) messages.push(...fieldMessages);
        });
        if (messages.length) throw new Error([...new Set(messages)].join(' '));
      }
      throw new Error(result.message || 'Unable to send your request.');
    }
    form.reset();
    form.querySelector('.success')?.classList.add('show');
  } catch (requestError) {
    error.textContent = requestError.message || 'Unable to send your request. Please try again.';
    error.hidden = false;
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
}

const applicationForm = document.querySelector('.access-form:not(.contact-form)');
const contactForm = document.querySelector('.contact-form');
if (applicationForm) {
  applicationForm.elements.usecase.minLength = 10;
  applicationForm.elements.social.setAttribute('inputmode', 'url');
}
applicationForm?.addEventListener('submit', event => { event.preventDefault(); submitForm(applicationForm, '/api/applications'); });
contactForm?.addEventListener('submit', event => { event.preventDefault(); submitForm(contactForm, '/api/contact'); });
document.querySelectorAll('form [required]').forEach(field => field.addEventListener('input', () => field.classList.remove('invalid')));
if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches){
  document.addEventListener('pointermove', e => {
    const x = e.clientX / innerWidth * 100, y = e.clientY / innerHeight * 100;
    document.documentElement.style.setProperty('--mx', x + '%'); document.documentElement.style.setProperty('--my', y + '%');
  }, {passive:true});
}
