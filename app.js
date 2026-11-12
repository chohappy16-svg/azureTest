'use strict'; // JavaScript 문법 오류를 쉽게 발견하도록 엄격 모드를 사용합니다.

// 1. HTML 요소를 JavaScript 변수와 연결합니다.
const fileInput = document.getElementById('fileInput'); // 사용자가 이미지 파일을 고르는 요소입니다.
const uploadBox = document.getElementById('uploadBox'); // 이미지 클릭 또는 드래그 영역입니다.
const uploadText = document.getElementById('uploadText'); // 파일 선택 전 안내 문구입니다.
const preview = document.getElementById('preview'); // 선택한 사진의 미리보기 요소입니다.
const fileInfo = document.getElementById('fileInfo'); // 선택한 파일 이름과 크기를 보여줍니다.
const statusBox = document.getElementById('status'); // 진행 상황과 오류를 보여주는 요소입니다.
const analyzeBtn = document.getElementById('analyzeBtn'); // AI 분석을 실행하는 버튼입니다.
const retryBtn = document.getElementById('retryBtn'); // AI 모델 다운로드 실패 시 사용하는 버튼입니다.
const bars = document.getElementById('bars'); // 분석 결과 막대그래프를 담는 영역입니다.
const description = document.getElementById('description'); // 가장 높은 분류 결과를 설명하는 영역입니다.

// 2. 프로그램이 기억해야 하는 값들을 선언합니다.
const MAX_BYTES = 10 * 1024 * 1024; // 업로드할 수 있는 최대 이미지 크기를 10MB로 제한합니다.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']); // 허용하는 파일 형식입니다.
let imageData = null; // 이미지의 축소된 PNG 데이터 URL을 저장합니다(파일 서버가 필요 없습니다).
let imageClassifier = null; // AI 모델을 불러오면 이 변수에 분류 함수를 저장합니다.
let loadingPromise = null; // 동시에 여러 번 모델을 다운로드하지 않도록 진행 상태를 보관합니다.
let analyzing = false; // 이미 분석 중인 경우 중복 실행을 막습니다.
let currentSelection = 0; // 파일을 연속 선택할 때 오래된 파일 처리를 무시할 번호입니다.
let lastModelError = false; // 모델을 불러오는 데 실패했는지 기억합니다.

// 3. 화면 상태를 일관되게 관리합니다.
function showStatus(message, isError = false) { // 상태 메시지를 화면에 표시하는 함수입니다.
    statusBox.textContent = message; // 화면에 안내 문구를 출력합니다.
    statusBox.classList.toggle('error', isError); // 오류이면 빨간색 디자인을 적용합니다.
}

function refreshButton() { // 이미지, AI 모델 및 실행 상태를 검사하여 버튼을 제어합니다.
    analyzeBtn.disabled = !imageData || analyzing || Boolean(loadingPromise); // 이미지가 없거나 작업 중이면 버튼을 비활성화합니다.
    if (analyzing) analyzeBtn.textContent = '이미지 분석 중...'; // 현재 분석 상태를 알려줍니다.
    else if (loadingPromise) analyzeBtn.textContent = 'AI 모델 내려받는 중...'; // AI 모델 다운로드 상태를 알려줍니다.
    else if (!imageData) analyzeBtn.textContent = '이미지를 먼저 선택해 주세요'; // 이미지 선택을 먼저 유도합니다.
    else if (imageClassifier) analyzeBtn.textContent = '이미지 분석'; // 모델이 이미 준비되어 있으면 바로 분석할 수 있습니다.
    else analyzeBtn.textContent = 'AI 모델 불러오기 및 이미지 분석'; // 첫 실행 때는 모델을 불러온 후 분석합니다.
}

// 4. 파일 선택과 미리보기는 인터넷 및 AI 라이브러리와 완전히 독립적으로 처리합니다.
function readImage(file) { // 이미지 File 객체를 브라우저 이미지로 읽는 함수입니다.
    return new Promise((resolve, reject) => { // 이미지 로딩이 끝날 때까지 기다리는 Promise를 만듭니다.
        const tempURL = URL.createObjectURL(file); // 사용자가 선택한 로컬 이미지에 임시 주소를 발급합니다.
        const img = new Image(); // 이미지의 실제 내용을 읽기 위한 객체를 만듭니다.
        img.onload = () => { URL.revokeObjectURL(tempURL); resolve(img); }; // 읽기 성공 시 임시 주소를 정리하고 이미지 객체를 돌려줍니다.
        img.onerror = () => { URL.revokeObjectURL(tempURL); reject(new Error('이미지를 읽지 못했습니다.')); }; // 읽기에 실패하면 오류를 돌려줍니다.
        img.src = tempURL; // 이미지 객체에게 파일 내용을 읽도록 요청합니다.
    }); // 이미지 로딩 Promise를 종료합니다.
}

function resizeToDataURL(img) { // 선택한 이미지를 AI 분석에 적합한 크기로 변환합니다.
    const MAX_SIDE = 512; // 지나치게 큰 사진이 메모리를 많이 사용하는 것을 방지합니다.
    const ratio = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight)); // 원본 비율을 유지할 축소 비율입니다.
    const canvas = document.createElement('canvas'); // 이미지 변환에 사용할 브라우저 캔버스를 만듭니다.
    canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio)); // 캔버스 너비를 계산합니다.
    canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio)); // 캔버스 높이를 계산합니다.
    const context = canvas.getContext('2d'); // 캔버스에 그림을 그릴 도구를 가져옵니다.
    if (!context) throw new Error('브라우저가 이미지 처리를 지원하지 않습니다.'); // 캔버스가 지원되지 않으면 중지합니다.
    context.drawImage(img, 0, 0, canvas.width, canvas.height); // 사진을 축소하여 캔버스에 그립니다.
    return canvas.toDataURL('image/png'); // 외부 파일 접근 없이 사용할 수 있는 PNG 데이터 주소를 반환합니다.
}

async function selectImage(file) { // 사용자가 선택한 이미지를 검사하고 미리보기로 보여줍니다.
    if (!file) return; // 파일 선택을 취소했다면 아무 작업도 하지 않습니다.
    const selectionNumber = ++currentSelection; // 이번 파일 선택 작업의 번호를 기록합니다.
    if (!IMAGE_TYPES.has(file.type)) { // 선택한 파일이 허용된 이미지 종류인지 검사합니다.
        showStatus('JPG, PNG, WEBP, GIF 이미지만 선택할 수 있습니다.', true); // 잘못된 형식을 사용자에게 알립니다.
        fileInput.value = ''; // 파일 선택창을 초기화합니다.
        return; // 검증 실패 시 처리를 중지합니다.
    }
    if (file.size === 0 || file.size > MAX_BYTES) { // 비어 있거나 10MB를 넘는 파일인지 검사합니다.
        showStatus('0바이트 파일은 사용할 수 없으며, 이미지 크기는 10MB 이하여야 합니다.', true); // 크기 제한을 안내합니다.
        fileInput.value = ''; // 파일 선택창을 초기화합니다.
        return; // 검증 실패 시 처리를 중지합니다.
    }
    try { // 파일을 실제 이미지로 열 수 있는지 검사합니다.
        const img = await readImage(file); // 사용자가 선택한 파일을 이미지 객체로 읽습니다.
        const nextData = resizeToDataURL(img); // AI와 미리보기용 이미지를 안전한 데이터 주소로 변환합니다.
        if (selectionNumber !== currentSelection) return; // 다른 이미지를 나중에 선택했다면 이전 작업을 무시합니다.
        imageData = nextData; // 이번 이미지 데이터를 분석할 대상으로 저장합니다.
        preview.src = nextData; // 사용자 화면에 미리보기 이미지를 표시합니다.
        preview.style.display = 'block'; // 숨겨져 있던 이미지 요소를 보이게 합니다.
        uploadText.style.display = 'none'; // 기존 안내 문구를 감춥니다.
        fileInfo.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`; // 파일 이름과 크기를 화면에 표시합니다.
        bars.textContent = '이미지 분석 버튼을 눌러주세요.'; // 이전 이미지의 분석 결과를 초기화합니다.
        description.textContent = ''; // 이전 이미지의 결과 설명을 지웁니다.
        description.style.display = 'none'; // 설명 영역을 숨깁니다.
        showStatus(imageClassifier ? '이미지 선택 완료! 분석 버튼을 눌러주세요.' : '이미지 선택 완료! 버튼을 누르면 AI 모델을 준비한 뒤 분석합니다.'); // 진행 상태를 알립니다.
        retryBtn.hidden = true; // 새 파일을 선택했으므로 재시도 버튼을 감춥니다.
        refreshButton(); // 이미지를 선택했으므로 분석 버튼을 활성화합니다.
    } catch (error) { // 이미지 파일이 손상됐거나 브라우저가 읽지 못한 경우 실행됩니다.
        if (selectionNumber !== currentSelection) return; // 더 새로운 선택이 있으면 이전 오류를 무시합니다.
        showStatus(`이미지를 읽을 수 없습니다: ${error.message}`, true); // 파일 읽기 오류를 사용자에게 보여줍니다.
        fileInput.value = ''; // 잘못된 파일 선택값을 비웁니다.
    }
}

fileInput.addEventListener('change', event => { // 사용자가 파일 선택 대화상자에서 이미지를 고를 때 실행합니다.
    void selectImage(event.target.files[0]); // 선택한 첫 번째 파일의 미리보기를 시작합니다.
}); // 파일 선택 이벤트 연결을 마칩니다.

uploadBox.addEventListener('dragover', event => { // 사용자가 파일을 업로드 영역 위로 끌어올 때 실행합니다.
    event.preventDefault(); // 브라우저가 이미지를 새 페이지로 열지 않게 합니다.
    uploadBox.classList.add('dragover'); // 드래그 중임을 테두리 색으로 보여줍니다.
}); // 드래그 이벤트 연결을 마칩니다.

uploadBox.addEventListener('dragleave', () => { // 파일을 업로드 영역 바깥으로 이동하면 실행합니다.
    uploadBox.classList.remove('dragover'); // 드래그 강조 표시를 지웁니다.
}); // 드래그 종료 이벤트 연결을 마칩니다.

uploadBox.addEventListener('drop', event => { // 파일을 업로드 영역에 놓았을 때 실행합니다.
    event.preventDefault(); // 브라우저의 기본 파일 열기 동작을 막습니다.
    uploadBox.classList.remove('dragover'); // 드래그 강조 표시를 지웁니다.
    void selectImage(event.dataTransfer.files[0]); // 놓은 이미지 파일을 검사하고 미리보기를 표시합니다.
}); // 파일 드롭 이벤트 연결을 마칩니다.

// 5. AI 모델은 이미지를 선택하고 분석 버튼을 눌렀을 때만 인터넷에서 불러옵니다.
async function loadClassifier() { // Hugging Face의 이미지 분류 모델을 준비하는 함수입니다.
    if (imageClassifier) return imageClassifier; // 모델이 이미 있다면 다시 다운로드하지 않습니다.
    if (loadingPromise) return loadingPromise; // 다른 작업이 다운로드 중이면 그 작업이 끝나기를 기다립니다.
    lastModelError = false; // 이전 모델 오류 상태를 초기화합니다.
    retryBtn.hidden = true; // 다운로드 중에는 재시도 버튼을 숨깁니다.
    showStatus('AI 라이브러리와 모델을 인터넷에서 내려받는 중입니다. 첫 실행에는 시간이 걸립니다.'); // 로딩 상태를 안내합니다.
    loadingPromise = (async () => { // 한 번만 실행할 모델 다운로드 작업을 생성합니다.
        const testFactory = window.__IMAGE_CLASSIFIER_TEST_FACTORY__; // 자동 테스트에만 쓰이는 가상 모델 공급자를 확인합니다.
        if (typeof testFactory === 'function') return await testFactory(); // 테스트 환경에서는 네트워크 대신 가상 모델을 사용합니다.
        const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'); // 원격 ES 모듈을 일반 스크립트에서 동적으로 불러옵니다.
        env.allowLocalModels = false; // 로컬 파일에서 AI 모델을 찾지 않도록 설정합니다.
        env.allowRemoteModels = true; // 인터넷에서 AI 모델 파일을 다운로드하도록 허용합니다.
        return await pipeline('image-classification', 'Xenova/vit-base-patch16-224'); // ViT 이미지 분류 모델을 준비하고 분류 함수를 반환합니다.
    })(); // 비동기 다운로드 작업을 시작합니다.
    refreshButton(); // 다운로드 중에는 분석 버튼을 잠깐 잠급니다.
    try { // 다운로드가 정상적으로 끝나는지 기다립니다.
        imageClassifier = await loadingPromise; // 모델 준비가 끝나면 분류 함수를 저장합니다.
        showStatus('AI 모델 준비 완료! 이미지 분석을 진행합니다.'); // 모델 준비 성공을 안내합니다.
        return imageClassifier; // 준비된 분류 함수를 분석 단계로 전달합니다.
    } catch (error) { // 인터넷 차단 또는 모델 다운로드 실패 시 실행합니다.
        lastModelError = true; // 모델 다운로드 오류를 기록합니다.
        console.error('AI 모델 로딩 실패:', error); // 개발자 도구에 기술적인 오류 메시지를 출력합니다.
        showStatus('AI 모델 다운로드에 실패했습니다. 인터넷 연결을 확인하고 재시도해 주세요. (F12 → Console)', true); // 사용자가 확인할 방법을 안내합니다.
        retryBtn.hidden = false; // 사용자가 다시 실행할 수 있도록 재시도 버튼을 보여줍니다.
        throw error; // 분석 단계에도 실패 사실을 알려줍니다.
    } finally { // 다운로드 성공·실패와 무관하게 정리합니다.
        loadingPromise = null; // 이후에 다시 시도할 수 있도록 진행 상태를 해제합니다.
        refreshButton(); // 버튼 상태를 현재 상황에 맞게 갱신합니다.
    }
}

// 6. AI가 반환한 분류 결과를 안전하게 화면에 그립니다.
function renderResults(results) { // AI 분석의 상위 분류 결과 목록을 인자로 받습니다.
    bars.replaceChildren(); // 이전 결과 그래프를 모두 삭제합니다.
    for (const result of results.slice(0, 5)) { // 결과가 많더라도 상위 다섯 개만 표시합니다.
        const scoreNumber = Math.max(0, Math.min(1, Number(result.score))); // 확률 값이 0~1 범위에 들도록 조정합니다.
        const percentage = (scoreNumber * 100).toFixed(1); // 확률을 소수점 한 자리의 퍼센트로 변환합니다.
        const row = document.createElement('div'); // 각 분석 결과를 담을 한 줄을 만듭니다.
        row.className = 'bar-container'; // 기존 CSS 그래프 디자인을 적용합니다.
        const label = document.createElement('div'); // 분류 이름이 들어갈 영역을 만듭니다.
        label.className = 'bar-label'; // 분류 이름 CSS 디자인을 적용합니다.
        label.textContent = String(result.label); // 분류명을 HTML로 해석하지 않고 안전한 텍스트로 표시합니다.
        label.title = String(result.label); // 마우스를 올리면 전체 분류명을 표시합니다.
        const track = document.createElement('div'); // 막대그래프 바탕을 만듭니다.
        track.className = 'bar-wrapper'; // 막대그래프 바탕 디자인을 적용합니다.
        const fill = document.createElement('div'); // 막대그래프가 채워지는 부분을 만듭니다.
        fill.className = 'bar-fill'; // 막대그래프 내부 색상을 적용합니다.
        fill.style.width = `${percentage}%`; // 예측 확률에 비례해 막대 너비를 지정합니다.
        const score = document.createElement('div'); // 결과의 확률 숫자 영역을 만듭니다.
        score.className = 'bar-score'; // 확률 숫자 디자인을 적용합니다.
        score.textContent = `${percentage}%`; // 화면에 확률 숫자를 표시합니다.
        track.append(fill); // 막대 바탕에 확률 채움 영역을 넣습니다.
        row.append(label, track, score); // 한 줄에 분류명, 막대, 숫자를 순서대로 넣습니다.
        bars.append(row); // 완성된 한 줄을 결과 화면에 추가합니다.
    }
    description.textContent = `가장 높은 예측 결과: ${results[0].label} (${(results[0].score * 100).toFixed(1)}%)`; // 가장 높은 예측 결과를 텍스트로 요약합니다.
    description.style.display = 'block'; // 요약 설명 영역을 화면에 표시합니다.
}

// 7. 분석 버튼을 누르면 준비된 이미지로 AI 추론을 시작합니다.
analyzeBtn.addEventListener('click', async () => { // 사용자가 이미지 분석 버튼을 누른 경우 실행합니다.
    if (!imageData || analyzing || loadingPromise) return; // 이미지가 없거나 다른 작업 중이면 중복 실행을 막습니다.
    analyzing = true; // 지금부터 분석 중이라는 상태를 기록합니다.
    refreshButton(); // 분석 중에 다시 버튼을 누르지 못하도록 잠급니다.
    const selectedData = imageData; // 분석을 시작할 당시의 이미지 데이터를 보관합니다.
    const selectedNumber = currentSelection; // 분석 시작 시점의 이미지 선택 번호를 보관합니다.
    bars.textContent = 'AI 분석을 준비하고 있습니다...'; // 분석 결과 영역의 안내 문구를 변경합니다.
    description.style.display = 'none'; // 이전에 출력한 설명을 숨깁니다.
    try { // 모델 준비와 추론 과정을 실행합니다.
        const classifier = await loadClassifier(); // AI 모델을 다운로드하거나 이미 준비한 모델을 가져옵니다.
        showStatus('선택한 이미지를 AI가 분석하고 있습니다...'); // 실제 분석 진행 상황을 표시합니다.
        const results = await classifier(selectedData, { topk: 5 }); // 이미지 분류 모델에게 상위 다섯 개 결과를 요청합니다.
        if (!Array.isArray(results) || results.length === 0) throw new Error('AI 분석 결과가 비어 있습니다.'); // 결과가 정상인지 검사합니다.
        if (selectedNumber !== currentSelection) return; // 분석 중 이미지가 바뀌었다면 오래된 결과를 표시하지 않습니다.
        renderResults(results); // 결과를 막대그래프 형태로 표시합니다.
        showStatus('AI 이미지 분석 완료!'); // 정상 완료 메시지를 표시합니다.
    } catch (error) { // 모델 준비 또는 AI 분석에 실패한 경우 실행합니다.
        console.error('AI 이미지 분석 오류:', error); // 구체적인 오류는 브라우저 콘솔에 출력합니다.
        if (selectedNumber === currentSelection) { // 이미지가 바뀌지 않은 경우에만 오류를 표시합니다.
            bars.textContent = '분석을 완료하지 못했습니다. 상태 메시지를 확인해 주세요.'; // 분석 실패 안내를 출력합니다.
            if (!lastModelError) showStatus('이미지 분석 중 오류가 발생했습니다. F12 → Console을 확인해 주세요.', true); // 모델 다운로드 외 오류에 대한 안내입니다.
        }
    } finally { // 성공·실패에 관계없이 마지막에 실행합니다.
        analyzing = false; // 분석 진행 상태를 종료합니다.
        refreshButton(); // 버튼을 다시 사용할 수 있도록 갱신합니다.
    }
}); // 분석 버튼 이벤트 연결을 마칩니다.

retryBtn.addEventListener('click', () => { // AI 모델 재시도 버튼을 누른 경우 실행합니다.
    retryBtn.hidden = true; // 재시도 버튼을 우선 숨깁니다.
    analyzeBtn.click(); // 분석 버튼을 통해 모델 다운로드와 분석을 다시 실행합니다.
}); // 재시도 버튼 이벤트 연결을 마칩니다.

refreshButton(); // HTML 파일을 열었을 때의 초기 버튼 상태를 설정합니다.
