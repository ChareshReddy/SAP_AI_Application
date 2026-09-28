process.env.USE_MOCK_SAP = 'false';

import {
  checkBomSubDependencies,
  verifyBomInCs03,
  validateSourceBom,
  ensureSapSession
} from '../services/sapGuiClient.js';

async function testLiveDependencyCheck() {
  console.log('=== Testing Live SAP Session ===');
  const sess = await ensureSapSession();
  console.log('Session ready:', sess);

  console.log('\n=== Testing verifyBomInCs03 on Source BOM (A1BH0214C, 1001, 1) ===');
  const srcVerify = await verifyBomInCs03({
    material: 'A1BH0214C',
    plant: '1001',
    bomUsage: '1'
  });
  console.log('Source verify result:', {
    success: srcVerify.success,
    exists: srcVerify.exists,
    componentCount: srcVerify.componentCount,
    componentsLength: srcVerify.components?.length,
    message: srcVerify.message,
    availableAlternatives: srcVerify.availableAlternatives
  });
  if (srcVerify.components && srcVerify.components.length > 0) {
    console.log('Sample components (first 3):', srcVerify.components.slice(0, 3));
    console.log('Assemblies found:', srcVerify.components.filter(c => c.assembly));
  }
}

testLiveDependencyCheck().catch(err => {
  console.error('Error in testLiveDependencyCheck:', err);
});
