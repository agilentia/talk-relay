// vim: ts=4:sw=4:expandtab

(function () {
    'use strict';

    self.F = self.F || {};

    F.PhoneSuggestionView = F.View.extend({
        template: 'util/phone_suggestion.html',

        initialize: function(x) {
            this.x = x;
        },

        events: {
            'click .member-info': 'onClick',
        },

        onClick: async function() {
            const threads = F.foundation.allThreads;
            const sl = await this.x.getSlug();
            await F.mainView.openThread(await threads.make('@' + sl, {type: 'conversation'}));
        },

        render_attributes: async function() {
            const name = this.x.getName();
            const avatar = await this.x.getAvatar();
            const slug = await this.x.getFQSlug();
            return {
                name,
                avatar,
                slug
            };
        }
    });
})();
