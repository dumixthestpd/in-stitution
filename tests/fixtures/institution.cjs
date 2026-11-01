const core = require('../../extension/core.js');
module.exports = core.normalizeProfile({
  id: 'fixture-u', library: 'standard-cas', name: 'Fixture University of Science and Technology', shortName: 'Fixture U',
  aliases: ['Fixture University of Science and Technology of Example', '示例大学', 'Fixture Univ Sci & Techlgy'],
  searchTerm: 'Fixture University of Science and Technology', carsiSearchTerm: '示例大学', federation: 'CHINA CERNET Federation',
  entityId: 'https://idp.fixture.edu/idp/shibboleth', identityOrigins: ['https://idp.fixture.edu'],
  cas: { loginUrl: 'https://cas.fixture.edu/cas/login', servicePrefixes: ['https://idp.fixture.edu/idp/'] }
});
