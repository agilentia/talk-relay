// vim: ts=4:sw=4:expandtab

(function() {
    'use strict';

    async function main() {
        await F.cache.startSharedCache();
        await F.tpl.loadPartials();
        F.signinView = new F.SigninView({el: $('body')});
        await F.signinView.render();
    }

    addEventListener('load', main);
    addEventListener('dbblocked', () => location.reload());
    addEventListener('dbversionchange', () => location.reload());
})();
