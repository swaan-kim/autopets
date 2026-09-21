const slotParam = new URLSearchParams(location.search).get('pet');
export const petIndex = slotParam !== null && /^[0-2]$/.test(slotParam) ? Number(slotParam) : null;
if (petIndex !== null) document.documentElement.classList.add('overlay');
