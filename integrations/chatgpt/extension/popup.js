const labels={'disabled':'연결이 꺼져 있어요.','enabled':'ChatGPT 연결을 허용했어요. 상태를 확인해 주세요.','local-connected':'로컬 앱 연결을 확인했어요. 자동 입력은 아직 꺼져 있어요.','local-unavailable':'AutoPets 앱을 실행한 뒤 다시 확인해 주세요.','native-unavailable':'로컬 연결 도구의 설치가 필요해요.','open-chatgpt':'ChatGPT 탭에서 연결 상태를 확인해 주세요.','reload-chatgpt':'ChatGPT 탭을 새로 연 뒤 확인해 주세요.','permission-required':'ChatGPT 접근 허용이 필요해요.','unavailable':'연결 상태를 확인하지 못했어요.'};
const show=r=>{document.querySelector('#status').textContent=labels[r?.status]||labels.unavailable;};
async function command(kind){try{show(await chrome.runtime.sendMessage({kind}));}catch{show({status:'unavailable'});}}
document.querySelector('#enable').addEventListener('click',async()=>{const granted=await chrome.permissions.request({origins:['https://chatgpt.com/*']});if(granted)await command('enable');else show({status:'permission-required'});});
document.querySelector('#check').addEventListener('click',()=>command('popup-status'));
document.querySelector('#disable').addEventListener('click',()=>command('disable'));
command('popup-status');
