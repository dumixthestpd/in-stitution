InstitutionPackSettings.register({
  load(config) {
    document.querySelector('#realm').value = config.account?.realm || 'university';
    document.querySelector('#account').value = config.account?.name || '';
    document.querySelector('#password').value = config.account?.password || '';
  },
  save() {
    const realm = document.querySelector('#realm').value;
    if (!['university', 'hospital'].includes(realm)) throw new Error('Choose an account realm.');
    return { account: { realm, name: document.querySelector('#account').value, password: document.querySelector('#password').value } };
  }
});
