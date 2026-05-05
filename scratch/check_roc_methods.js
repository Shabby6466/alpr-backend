const path = require('path');
const roc = require(path.resolve(process.cwd(), 'roc.node'));

(async () => {
    roc.roc_initialize(null);
    roc.roc_set_model_path('/Volumes/ROCSDK/data');
    const gallery = await roc.roc_open_gallery(null);
    const testId = '7e9d9589-d949-42e6-bf68-ae8094028291';
    
    // Create a dummy template object (this might fail without a real template buffer)
    const t = { 
        template: Buffer.alloc(1024), 
        person_id: testId 
    };
    
    console.log('Enrolling with string person_id...');
    try {
        await roc.roc_enroll(gallery, t);
        console.log('Enrollment successful!');
        
        const candidate = await roc.roc_at(gallery, 0);
        console.log('Enrolled person_id:', roc.roc_uuid_to_string(candidate.person_id, false));
    } catch (e) {
        console.log('Enrollment failed:', e.message);
    }
    roc.roc_finalize();
})();
